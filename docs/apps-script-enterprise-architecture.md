Enterprise web applications on Google Apps Script Web Apps

Architecture limits, high-concurrency check-ins, and GCP fallback queues

Prepared for:

 Engineering Team




Date:

 15 October 2026




Format:

 Technical architecture note and decision guide

Executive recommendation

Google Apps Script Web Apps are a good fit for an internal tool with a lightweight interface, simple workflows, and a Google Workspace-shaped operating model. They are a poor fit as the only request-processing layer for a system where check-ins, exports, email dispatch, or other actions must remain reliable during bursts.

For the event check-in example, use this split:

HtmlService

 serves the interface.

google.script.run

 handles small, user-facing calls.

A durable queue

 receives important events before the UI reports that they are accepted.

BigQuery

 stores the durable event history and supports reporting.

Google Sheets

 is an operational view or admin surface, not the authoritative high-concurrency write store.

Cloud Tasks, Pub/Sub, Cloud Run functions, or Cloud Run

 process exports, email jobs, and other background work.

The most important correction to the earlier answer is this: 

CacheService

 is not a reliable queue.

 Cache entries can expire or be evicted, and Apps Script does not provide a queue-style way to enumerate and acknowledge pending cache items. Use it for short-lived caching, deduplication hints, or UI acceleration. Use Pub/Sub, Cloud Tasks, or a database-backed outbox when losing an event is unacceptable.


--------------------------------------------------------------------------------


1. What this document covers

After reading this note, you should be able to:

distinguish published Apps Script limits from latency values that Google does not guarantee;

design a 200-person QR check-in burst without making one Google Sheet the critical path;

choose between direct Sheets writes, BigQuery ingestion, Pub/Sub, and Cloud Tasks;

move heavy exports and bulk email work outside the Apps Script request;

identify the architecture decisions that need agreement before implementation.

The design assumes a Google Workspace account, an Apps Script Web App deployed for internal users, and access to a Google Cloud project where required.


--------------------------------------------------------------------------------


2. The important mental model

Imagine 200 people arriving at a venue. The web page is the check-in desk, Apps Script is the receptionist, Sheets is a shared clipboard, and BigQuery or a queue is the back-office system.

A shared clipboard works when a few people use it. It becomes a queue at the desk when everyone writes to the same place at once. The reliable design is to accept each person quickly, record the event in a system designed for concurrent intake, and update the clipboard asynchronously.

That gives each layer one job:

Layer

Job

What it should not do

HtmlService

Render the UI and collect input

Run heavy server work in page templates

google.script.run

Call small server-side functions

Serve as a durable message broker

Apps Script

Validate, authorize, and dispatch

Process large exports or hundreds of emails synchronously

Pub/Sub or Cloud Tasks

Buffer and control background work

Act as the user-facing database

BigQuery

Store and analyze event history

Replace a low-latency transactional database for every use case

Sheets

Give coordinators an editable operational view

Be the sole source of truth for bursty writes


--------------------------------------------------------------------------------


3. Published Apps Script limits

Google publishes quotas and limits, but it does 

not

 publish a guaranteed latency or p95/p99 response-time target for HtmlService or 

google.script.run

. Treat latency as something to measure in your deployment, not as a contractual platform number.

The official quota reference is 

Quotas for Google Services | Apps Script

https://developers.google.com/apps-script/guides/services/quotas

.

3.1 Runtime and concurrency limits

Limit

Published value or behavior

Architecture meaning

Maximum runtime for one Apps Script execution

6 minutes

A Web App request that invokes server-side Apps Script must finish within the execution limit. Keep interactive functions far below this.

Custom function runtime

30 seconds

Avoid using spreadsheet custom functions for application workflows or external calls.

Simple trigger runtime

30 seconds

Simple triggers are unsuitable for heavy processing.

Total runtime for installable triggers

90 minutes/day

 for consumer accounts; 

6 hours/day

 for Google Workspace accounts

This is cumulative background runtime, separate from the six-minute single-run limit.

Simultaneous executions per user

30

A burst can fail if too many executions are attributable to the same user or effective identity.

Simultaneous executions per script

1,000

This is not a promise that a Web App will provide 1,000 useful concurrent requests. Service quotas, Sheets contention, browser limits, and downstream APIs usually become constraints first.

google.script.run

 calls in flight per browser page

10

An 11th call waits until one of the first ten finishes. This is a client-side concurrency cap, not a server throughput guarantee.

Triggers per user per script

20

Do not create one time-based trigger per job as the main queueing strategy.

The 

google.script.run

 limit is documented in 

HTML Service: Communicate with Server Functions

https://developers.google.com/apps-script/guides/html/communication

. Google states that calls are asynchronous, may complete out of order, and are limited to ten concurrent calls per page.

The Apps Script quota page also explains that exceeding quotas causes an exception and stops the execution. You should monitor executions and service-specific quotas rather than treating these numbers as a capacity guarantee.

3.2 Common Workspace quotas that matter here

The following are commonly relevant to an internal Google Workspace application. They can change, so verify them against the official quota page before launch.

Quota

Workspace value commonly published

Design implication

UrlFetchApp

 calls

100,000/day

A dispatcher that calls Cloud Run or Cloud Functions consumes this quota. Batch or queue calls where possible.

UrlFetchApp

 data transferred

500 MB/day

Do not move large exports through Apps Script. Put them in Cloud Storage and return a link.

Email recipients

1,500 recipients/day

This is a recipient quota, not a simple “number of messages” quota. It still applies to Apps Script mail operations.

Properties storage

9 MB total

, with a per-property limit

Use properties for configuration and small checkpoints, not event queues or export payloads.

Cache item size

100 KB per item

Cache is temporary. It is not a durable queue or database.

There are additional service-specific limits for Sheets, Drive, Gmail, BigQuery, and external APIs. A system can stay below the Apps Script runtime limit and still fail because a downstream service quota was exceeded.

3.3 HtmlService and browser restrictions

HtmlService pages run in an iframe sandbox. The remaining sandbox mode is 

IFRAME

. Active content such as scripts, external stylesheets, and XMLHttpRequests must use HTTPS. Links that leave the iframe need an appropriate target such as 

_top

 or 

_blank

.

See 

HTML Service: Restrictions

https://developers.google.com/apps-script/guides/html/restrictions

.

For a QR scanner, test camera access on the actual mobile devices and browsers used at the event. An HtmlService page is not the same environment as a normal standalone site, and browser permission behavior can be affected by iframe and deployment settings.


--------------------------------------------------------------------------------


4. 

google.script.run

: what is exact and what is not

Exact behavior

google.script.run

 is an asynchronous client-to-server API. A call does not return a value directly. The result goes to a success handler, and an exception goes to a failure handler.

<script>
  function submitCheckIn(checkIn) {
    setBusy(true);

    google.script.run
      .withSuccessHandler(function (result) {
        setBusy(false);
        showStatus(result.status, result.message);
      })
      .withFailureHandler(function (error) {
        setBusy(false);
        showStatus('error', error && error.message ? error.message : 'Request failed');
      })
      .recordCheckIn(checkIn);
  }
</script>


html

The call is asynchronous, and two calls started together may complete in either order. Use a request ID and update the matching UI element rather than assuming that responses arrive in submission order.

Parameters and return values must be serializable JavaScript primitives, arrays, and objects composed of those values. 

Date

, 

Function

, most DOM elements, and circular objects are not legal values. The form element is a special case and must be the only parameter.

No exact RPC latency is published

Google does not publish an exact HtmlService page-load latency, a fixed 

google.script.run

 round-trip latency, or a p95/p99 guarantee. The observed time includes:

browser and network time;

Apps Script startup time;

server-side Apps Script execution;

calls to Sheets, Drive, Gmail, BigQuery, or other services;

response serialization and delivery back to the page.

A simple function may feel fast in a test and slow during an event. Measure the full path under a burst test. Do not design around claims such as “RPCs usually take one to four seconds” unless that is a measured result for your deployment.

How to measure it

Add a client request ID and timestamps at both ends:

// Server-side Apps Script
function recordCheckIn(request) {
  var receivedAt = Date.now();

  // Validate and enqueue here.
  var result = enqueueCheckIn_(request);

  return {
    requestId: request.requestId,
    receivedAtMs: receivedAt,
    completedAtMs: Date.now(),
    queueStatus: result.status
  };
}


javascript

<script>
  function submitCheckIn(request) {
    request.clientSentAt = Date.now();

    google.script.run
      .withSuccessHandler(function (response) {
        response.clientRoundTripMs = Date.now() - request.clientSentAt;
        console.log('check-in timing', response);
      })
      .withFailureHandler(function (error) {
        console.error('check-in failed', {
          requestId: request.requestId,
          clientRoundTripMs: Date.now() - request.clientSentAt,
          error: error && error.message
        });
      })
      .recordCheckIn(request);
  }
</script>


html

Record at least:

page-load time;

RPC round-trip time;

server execution time;

queue-accept time;

time until the event appears in BigQuery;

time until the Sheets operational view is updated;

error type and retry count.

Use p50, p95, p99, timeout rate, duplicate rate, and lost-event rate as the acceptance criteria.


--------------------------------------------------------------------------------


5. High-concurrency QR check-ins

Is 200 people in ten minutes too much?

The average rate is about 20 check-ins per minute, or one every three seconds. That average is modest. The real question is the burst shape:

Do 50 people scan in the same 10-second window?

Are they all using the same page and network?

Does each scan trigger one RPC or several?

Does the server read a large attendee sheet before writing?

Does it check for duplicates by scanning the whole sheet?

Does it send email or update several tabs during the request?

A 200-person event may work with a carefully batched Sheets implementation. It is still a poor idea to make Sheets the only durable intake system if attendance records matter.

Recommended check-in flow

flowchart LR
    A[Attendee scans QR code] --> B[HtmlService UI]
    B --> C[google.script.run]
    C --> D[Apps Script validation]
    D --> E[Authenticated enqueue request]
    E --> F[Pub/Sub or Cloud Tasks]
    F --> G[Cloud Run function worker]
    G --> H[BigQuery authoritative event table]
    G --> I[Sheets operational view]
    H --> J[Admin reports]


mermaid

The UI should show 

Queued

 after the durable queue accepts the request. Show 

Checked in

 after the worker confirms the event has been written to the authoritative store, or define “Queued” as the official operational success state if that is acceptable for the event.

Do not show a successful check-in before any durable acceptance. A client-side optimistic message can create a dangerous gap: the attendee sees success while Apps Script, the queue, or the data store has rejected the event.

Minimum viable design: Apps Script plus Sheets

Use this only when a short outage or a small amount of manual reconciliation is acceptable.

Generate a unique 

check_in_id

 in the browser or server.

Send exactly one RPC per scan.

Validate the event ID, attendee ID, QR signature, and timestamp.

Avoid reading the entire sheet during the scan.

Use a short script lock only around the smallest critical section if the code must perform a read-then-write operation.

Batch writes wherever possible.

Return a clear retryable error if the lock cannot be obtained.

Reconcile duplicates using the unique 

check_in_id

 after the event.

LockService

 prevents concurrent execution of a protected code section. A script lock serializes that section for all users of the script. A document lock is scoped to a document. See 

Lock Service

https://developers.google.com/apps-script/reference/lock

.

A lock protects your application logic. It does not make Sheets a high-throughput database. Holding a lock while reading a large sheet, sending email, or calling a slow external API turns the lock into a queue with a six-minute execution ceiling.

Better design: queue the event before touching Sheets

The server-side Apps Script function should do only four things:

validate the request;

create or preserve an idempotency key;

send the small event to a durable queue or ingestion endpoint;

return the queue result.

The worker then writes BigQuery and updates Sheets in batches.

A useful event shape is:

{
  "event_id": "event-2026-10-15",
  "check_in_id": "uuid-generated-per-scan",
  "attendee_id": "attendee-123",
  "scanned_at": "2026-10-15T09:12:31.402Z",
  "source": "qr",
  "schema_version": 1
}


json

The worker must be idempotent. If the same message is delivered twice, the second delivery must not create a second attendance record. Cloud Tasks explicitly uses at-least-once delivery, so repeated execution is possible and handlers must be safe to run again. See 

Understand Cloud Tasks

https://cloud.google.com/tasks/docs/dual-overview

.

Why 

CacheService

 should not be the queue

CacheService

 is useful for:

caching attendee lookup data;

storing a short-lived duplicate-suppression hint;

avoiding repeated reads of a stable configuration value.

It is not suitable for:

storing a check-in that must never be lost;

collecting unknown numbers of pending events;

enumerating and acknowledging a queue;

guaranteeing delivery after an Apps Script failure.

Cache items can expire or be evicted. There is no queue consumer model. If you need buffering, use Pub/Sub or Cloud Tasks. If you need a small, durable outbox, use a real datastore or a dedicated BigQuery ingestion endpoint.

BigQuery as the authoritative event store

BigQuery is appropriate for an event log and reporting. It is not a task queue. Use a queue to absorb the burst and BigQuery to store the resulting events.

Options:

Option

When to choose it

Duplicate behavior

Pub/Sub plus BigQuery subscription

Events need buffering and the payload maps cleanly to a table

Design for at-least-once delivery; deduplicate in the data model if required

Pub/Sub plus Cloud Run function

Events need validation, enrichment, or multiple writes

Worker controls validation and idempotency

BigQuery Storage Write API

A trusted service needs high-throughput streaming directly into BigQuery

Use committed streams and offsets when exactly-once write semantics are required

Legacy 

tabledata.insertAll

Small/simple ingestion where best-effort 

insertId

 deduplication is acceptable

insertId

 deduplication is best effort, not a universal exactly-once guarantee

The 

BigQuery Storage Write API

https://cloud.google.com/bigquery/docs/write-api

 supports streaming and batch-style ingestion patterns. For a 200-person check-in event, the volume is small, so the decision should be driven by reliability, operating model, and existing GCP standards rather than raw throughput.

Updating Sheets safely

Treat Sheets as a projection of the event log:

The worker consumes accepted events.

It writes rows in batches, for example every few seconds or every few dozen events.

It records the last processed queue offset or event timestamp.

It retries failed batches.

It sends poison or permanently invalid events to a dead-letter path.

If coordinators need a live count, calculate it from BigQuery or maintain a small summary row. Do not make each attendee scan update several formulas, conditional formats, and dashboard ranges synchronously.


--------------------------------------------------------------------------------


6. Cloud Functions, Cloud Run, Pub/Sub, and Cloud Tasks

Cloud Functions is now documented as Cloud Run functions in parts of the Google Cloud documentation. The architecture matters more than the product label: Apps Script should hand off work to a managed Google Cloud worker and return quickly.

Pub/Sub: a buffer for event streams

Pub/Sub decouples producers from consumers. Google describes it as an asynchronous, scalable messaging service and notes that it is commonly used for user-interaction events, streaming analytics, parallel work, and email notifications. See 

What is Pub/Sub?

https://cloud.google.com/pubsub/docs/overview

.

Choose Pub/Sub when:

many events can arrive together;

more than one consumer may need the event;

the event is part of an analytics or integration stream;

you want retention, replay, filtering, or dead-letter topics;

a small delay is acceptable.

A typical check-in path is:

HtmlService
  -> google.script.run
  -> Apps Script validation
  -> authenticated Cloud Run/Cloud Function endpoint
  -> Pub/Sub topic
  -> BigQuery subscription or worker
  -> BigQuery + Sheets projection


text

Cloud Tasks: controlled background work

Cloud Tasks is a better fit when each job has one worker and you need delivery-rate control, scheduling, task naming, or retries. It is especially useful for:

one email per recipient;

one export job per request;

one document generation task per event;

throttling a downstream API;

smoothing a burst without processing everything at once.

Cloud Tasks provides at-least-once delivery, configurable dispatch rates, retries, and task deduplication through unique task names. Its HTTP target must return a 2xx response for the task to be considered complete. The documented default handler deadline is ten minutes, with a maximum of thirty minutes for generic HTTP targets. See 

Understand Cloud Tasks

https://cloud.google.com/tasks/docs/dual-overview

.

Cloud Functions or Cloud Run: the worker

Use a worker to:

read the job payload;

query BigQuery;

create a file in Cloud Storage;

call an approved email provider;

update a job-status table;

retry transient failures;

record permanent failures for review.

For very small jobs, a Cloud Run function is simple. For a long export, custom dependencies, higher control over concurrency, or a multi-step process, Cloud Run or Workflows may be a better fit.


--------------------------------------------------------------------------------


7. Heavy administrative exports

Recommended export pattern

The admin clicks 

Export

 in the Apps Script UI.

Apps Script validates the admin and creates an 

export_job_id

.

Apps Script submits a job to Cloud Tasks or Pub/Sub.

The worker starts a BigQuery query job.

The query writes results to a temporary or job-specific table if needed.

BigQuery exports the result to Cloud Storage as CSV, JSON, or Parquet.

The worker records the file URI, row count, expiry time, and status.

The Apps Script UI polls a small job-status function or displays a link when ready.

Return 

Export queued

, not a long-running spinner.

The job-status record should include:

export_job_id
requested_by
requested_at
filters_hash
status: QUEUED | RUNNING | COMPLETE | FAILED
row_count
file_uri
expires_at
error_code
error_message_for_admin


text

Do not route a multi-megabyte CSV through 

google.script.run

, Apps Script properties, or 

UrlFetchApp

. Store the file in Cloud Storage and give the authorized admin a controlled link or copy it to an approved Drive folder after generation.

Retry rules

Retry transient BigQuery, Storage, and network errors with exponential backoff.

Do not retry invalid SQL, invalid permissions, or malformed filters indefinitely.

Use an idempotent job ID so a retry does not create an uncontrolled set of duplicate exports.

Delete temporary files according to a retention policy.

Log who requested the export and which filters were used.


--------------------------------------------------------------------------------


8. Bulk email dispatch

Do not confuse compute limits with email limits

Moving email sending to Cloud Functions removes the Apps Script execution limit from the worker. It does 

not

 automatically remove the sending provider's email quotas, Gmail sending limits, recipient policies, spam controls, or compliance requirements.

If the sender remains Gmail or the Gmail API, Gmail limits still apply. If the organization uses a transactional email provider, that provider's API limits, unsubscribe rules, bounce handling, domain authentication, and data-processing requirements apply instead.

Recommended email pattern

Apps Script creates a campaign or dispatch job.

The recipient set is materialized as rows with a stable 

recipient_job_id

.

Cloud Tasks receives one task per recipient or per small batch.

A worker sends the message through the approved provider.

The worker records 

SENT

, 

RETRYING

, 

BOUNCED

, 

REJECTED

, or 

FAILED

.

The worker retries only transient errors.

A dead-letter queue captures messages that remain unsuccessful.

The admin UI reads aggregate status rather than waiting for every email.

Use a stable key such as:

campaign_id + recipient_email + template_version


text

This prevents a retry from sending the same message twice when the provider accepted the request but the worker timed out before receiving the response.

When Apps Script is still enough

Apps Script can remain the mail worker for a small internal notification set if:

the recipient volume is comfortably below the current Workspace quota;

the content is simple;

delayed delivery is acceptable;

the job is chunked across executions;

every recipient has a durable status and retry path.

For event-day bulk messages or personalized dispatches, the queue-based worker is easier to observe and control.


--------------------------------------------------------------------------------


9. Security and deployment design

Web App deployment choices

Decide whether the Web App runs as:

The owner/deployer:

 useful when attendees should not need direct access to Sheets or BigQuery. It concentrates authorization and some quota pressure on the effective account.

The user accessing the Web App:

 useful when access should follow each user's identity. It creates more complicated authorization and user-consent behavior.

Use the least privilege that still supports the workflow. Avoid embedding API keys in HtmlService. Keep secrets in a managed secret store or protected server-side configuration. Treat every browser-supplied attendee ID, event ID, and timestamp as untrusted input.

Protect the QR code

A QR code that contains only an attendee ID is easy to copy. Consider a signed token containing:

event ID;

attendee ID;

expiry time;

token version;

signature generated by a server-held secret.

The worker or validation service checks the signature before accepting the event. Decide whether a token can be used once, whether staff can override a duplicate, and how manual corrections are recorded.

Audit fields

For every accepted scan, store:

check_in_id

;

event ID;

attendee ID;

scanned timestamp in UTC;

received timestamp;

source and app version;

operator or authenticated user if known;

processing status;

duplicate or correction reason;

correlation ID for logs.


--------------------------------------------------------------------------------


10. Testing plan before an event

Load test scenarios

Run the test against a staging deployment and a staging dataset.

Steady rate:

 20 scans/minute for ten minutes.

Burst:

 50 scans in ten seconds.

Duplicate burst:

 the same 10 attendees scan three times each.

Downstream outage:

 make the worker or BigQuery path fail temporarily.

Slow Sheets:

 add enough formulas or contention to make the projection slow.

Browser refresh:

 resubmit after a network timeout.

Multiple gates:

 simulate several browser sessions and operator devices.

Worker retry:

 force a timeout after the downstream write succeeds.

Acceptance criteria

Agree the thresholds before testing. Example criteria:

0 lost accepted events;

duplicate rate is explainable and reconciled;

99% of valid scans receive a queue acceptance within the agreed time;

a worker outage does not lose queued events;

failed events are visible to an operator;

Sheets lag is visible and acceptable;

the system can be manually reconciled from BigQuery and the queue log.

The exact latency target should come from the event experience. A check-in desk may need a fast “accepted” response, while the Sheets admin view may tolerate a 30-second delay.


--------------------------------------------------------------------------------


11. Key decisions to make before finalizing

What is the authoritative record?

 Sheets, BigQuery, or another datastore?

What does success mean to the attendee?

 “Request received,” “queued,” or “persisted to BigQuery”?

What is the maximum acceptable delay for the admin view?

 Immediate, 10 seconds, one minute, or end of event?

What is the maximum burst?

 Average traffic is not enough. Define the likely 5-second and 30-second peaks.

Do duplicate scans count as one attendance record?

 If yes, where is deduplication enforced?

Is a queue allowed to delay check-ins during an outage?

 If yes, define how long queued events are retained and how staff are informed.

Do attendees need a public link?

 If yes, decide how access, token signing, rate limiting, and abuse protection work.

Which GCP services are approved by the organization?

 Pub/Sub, Cloud Tasks, Cloud Run functions, Cloud Run, BigQuery Storage Write API, Cloud Storage, Secret Manager, and Workflows have different ownership and setup requirements.

What email provider is approved?

 Moving the worker to GCP does not remove Gmail or provider-level sending limits.

Who owns operations during the event?

 Name the person who monitors the queue, retries failed jobs, and performs reconciliation.

What is the retention policy?

 Check-in records, logs, exported files, and dead-letter messages may have different retention requirements.

What is the fallback at the venue?

 A manual attendance sheet or offline capture process should exist if the network or platform is unavailable.


--------------------------------------------------------------------------------


12. Final recommendation for the 200-person event

For a one-off or low-risk event, a carefully implemented Apps Script Web App writing to Sheets may be sufficient if you run the burst test, use unique IDs, keep the request small, and provide a manual reconciliation path.

For a repeatable enterprise tool, use:

HtmlService UI
  -> google.script.run
  -> Apps Script validation and authorization
  -> Cloud Run/Cloud Function enqueue endpoint
  -> Pub/Sub for check-in events
  -> BigQuery authoritative event table
  -> batched Sheets projection for coordinators

Admin exports
  -> Cloud Tasks or Pub/Sub
  -> Cloud Run/Cloud Function worker
  -> BigQuery query job
  -> Cloud Storage output
  -> job status and controlled download link

Bulk email
  -> recipient job table
  -> Cloud Tasks with rate control
  -> approved email worker/provider
  -> per-recipient status and dead-letter handling


text

This keeps the Apps Script layer where it is strongest: internal UI, Google Workspace authorization, lightweight validation, and coordination. It keeps burst absorption, durable processing, large data movement, and retry control in services designed for those jobs.

Sources

Quotas for Google Services | Apps Script

https://developers.google.com/apps-script/guides/services/quotas

HTML Service: Communicate with Server Functions

https://developers.google.com/apps-script/guides/html/communication

HTML Service: Restrictions

https://developers.google.com/apps-script/guides/html/restrictions

HTML Service: Best Practices

https://developers.google.com/apps-script/guides/html/best-practices

Lock Service

https://developers.google.com/apps-script/reference/lock

What is Pub/Sub?

https://cloud.google.com/pubsub/docs/overview

Understand Cloud Tasks

https://cloud.google.com/tasks/docs/dual-overview

BigQuery Storage Write API

https://cloud.google.com/bigquery/docs/write-api
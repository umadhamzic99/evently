Phase 1: Blueprinting & Product Specification

These questions define the business rules, edge cases, and scope of the platform before any design begins.

Event Types & Rules:

 What distinct types of events must this system support (e.g., 1-hour manager training vs. 3-day leadership retreat), and what unique rules apply to each?

Identity & Access:

 How are we identifying the people walking through the door? Are they strictly internal employees with corporate emails, or will we have external contractors without company credentials?

Waitlist Logic:

 When a session reaches capacity, what exactly happens? Do people automatically move off the waitlist when a spot opens, or does a coordinator have to manually approve them?

Roles & Permissions:

 Who is allowed to do what? (e.g., Can a volunteer scanning at the door manually override a rejected ticket, or does that require a lead coordinator?)

Phase 2: UI Prototyping & Frontend Design

These questions define the user journey, screen layouts, and exactly what the user sees and clicks.

The Scanner Experience:

 What is the absolute minimum information a volunteer needs to see on their tablet to process a line of 50 people quickly and accurately?

The Offline Fallback:

 When the venue Wi-Fi completely drops, what exactly does the screen show the volunteer, and how does their workflow change?

Walk-In Management:

 If someone shows up who isn't on the registration list, what are the exact steps on the screen to get them registered, checked in, and inside the room within 30 seconds?

Coordinator Dashboard:

 While the event is running, what real-time numbers does the lead organizer need to see on their tablet to know if things are going smoothly?

Phase 3: Backend, Queuing & Data Infrastructure

These questions define the invisible mechanics, data flow, and automated actions triggered by the app.

The Audit Trail:

 For every single ticket scan, what exact details must we permanently record to prove that person was in the room (e.g., exact time, door name, volunteer who scanned them)?

Asset Automation:

 The moment someone registers, what specific assets need to be generated for them? (e.g., Do they need a calendar invite that auto-updates if the room changes? Do they need a personalized PDF badge sent to their inbox?)

Conflict Resolution:

 If a participant screenshots their QR code and sends it to a colleague, and both try to scan at different doors at the exact same time, what should the system do?

Pre/Post Communications:

 What automated reminders do people need before the event, and what follow-up emails should trigger after they check out?

Phase 4: Analytics & Organizer Reporting

These questions define how the business measures success and moves data into official HR/Learning systems.

LMS Reconciliation:

 After the event concludes, what exact format does the attendance data need to be in so it can be seamlessly uploaded into Workday Learning?

Executive Metrics:

 What key metrics does an L&D or People Ops leader need to see on a dashboard to determine if this event was a success?

No-Show Tracking:

 How do we categorize and report on people who registered but didn't show up, and who needs to see that information?

Session Popularity:

 For multi-track events (like a summit with different breakout rooms), how do we report on which topics had the highest engagement versus which ones were empty?
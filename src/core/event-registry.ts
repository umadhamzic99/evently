import { EventTypeSlug, EventTypeTemplate, EventRecord } from '../types/index.js';

/**
 * Built-in baseline templates for Evently.
 * These define core mechanics and baseline defaults, not immutable limits.
 */
export const EVENT_TYPE_REGISTRY: Record<EventTypeSlug, EventTypeTemplate> = {
  manager_workshop: {
    slug: 'manager_workshop',
    label: '1-Hour Manager Workshop',
    isMultiDay: false,
    hasSessions: false,
    requiresCohort: false,
    hasTracks: false,
    defaultConfig: {
      defaultCapacity: 15,
      requiresRoom: true,
      defaultDurationDays: 1,
    },
  },
  leadership_retreat: {
    slug: 'leadership_retreat',
    label: '3-Day Leadership Retreat',
    isMultiDay: true,
    hasSessions: true,
    requiresCohort: false,
    hasTracks: false,
    defaultConfig: {
      defaultCapacity: 30,
      requiresRoom: true,
      defaultDurationDays: 3,
    },
  },
  compliance_cohort: {
    slug: 'compliance_cohort',
    label: 'Compliance Training Cohort',
    isMultiDay: false,
    hasSessions: false,
    requiresCohort: true,
    hasTracks: false,
    defaultConfig: {
      defaultCapacity: 50,
      passingScoreRequired: true,
      defaultDurationDays: 1,
    },
  },
  internal_summit: {
    slug: 'internal_summit',
    label: 'Internal Summit',
    isMultiDay: true,
    hasSessions: true,
    requiresCohort: false,
    hasTracks: true,
    defaultConfig: {
      defaultCapacity: 500,
      requiresRoom: true,
      hasTracks: true,
      defaultDurationDays: 3,
    },
  },
};

export interface CreateEventParams {
  id?: string;
  eventTypeSlug: EventTypeSlug;
  title: string;
  description?: string;
  ownerUserId: string;
  startDate: string;
  endDate: string;
  timezone?: string;
  maxCapacity?: number;
  waitlistEnabled?: boolean;
  waitlistPromotionMode?: 'automatic' | 'manual_approval';
  registrationDeadline?: string;
  config?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

/**
 * Event Factory: Instantiates an event by applying type template defaults
 * and cleanly overriding capacity, dates, and dynamic configuration.
 */
export function createEvent(params: CreateEventParams): EventRecord {
  const template = EVENT_TYPE_REGISTRY[params.eventTypeSlug];
  if (!template) {
    throw new Error(`Unknown event type slug: ${params.eventTypeSlug}`);
  }

  // Date validation
  const start = new Date(params.startDate);
  const end = new Date(params.endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('Invalid start or end date format');
  }
  if (end < start) {
    throw new Error('Event end date cannot be earlier than start date');
  }

  // Capacity: explicitly allow overriding template default
  const capacity =
    params.maxCapacity !== undefined
      ? params.maxCapacity
      : template.defaultConfig.defaultCapacity;

  if (capacity < 0) {
    throw new Error('Event capacity cannot be negative');
  }

  const now = new Date().toISOString();

  return {
    id: params.id || `evt_${Math.random().toString(36).substring(2, 11)}`,
    eventTypeSlug: params.eventTypeSlug,
    title: params.title.trim(),
    description: params.description,
    status: 'draft',
    ownerUserId: params.ownerUserId,
    startDate: params.startDate,
    endDate: params.endDate,
    timezone: params.timezone || 'Europe/Berlin',
    maxCapacity: capacity,
    waitlistEnabled: params.waitlistEnabled ?? true,
    waitlistPromotionMode: params.waitlistPromotionMode || 'automatic',
    registrationDeadline: params.registrationDeadline,
    config: {
      ...template.defaultConfig,
      ...(params.config || {}),
    },
    attributes: params.attributes || {},
    createdAt: now,
    updatedAt: now,
  };
}

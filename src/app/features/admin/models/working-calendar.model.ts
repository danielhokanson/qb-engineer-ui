export interface Holiday {
  id: number;
  date: string; // YYYY-MM-DD
  name: string;
  observedDate: string | null;
  isRecurring: boolean;
}

export interface WorkingCalendar {
  id: number;
  name: string;
  timeZone: string;
  workingDaysMask: number;
  isDefault: boolean;
  isActive: boolean;
  holidays: Holiday[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkingCalendarRequest {
  name: string;
  timeZone: string;
  workingDaysMask: number;
  isActive: boolean;
}

export interface HolidayRequest {
  date: string; // YYYY-MM-DD
  name: string;
  observedDate: string | null;
  isRecurring: boolean;
}

/**
 * 7-bit bitmask: bit 0 = Sunday, bit 1 = Monday, ..., bit 6 = Saturday.
 * Default for US installs is Mon-Fri = 0b0111110 = 62.
 */
export const WORKING_DAYS_MASK_DEFAULT = 0b0111110; // 62

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

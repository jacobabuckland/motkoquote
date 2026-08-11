/**
 * Returns a time-based greeting based on the hour of the day.
 * @param hour - The hour (0-23) to get a greeting for
 * @returns "Good morning", "Good afternoon", or "Good evening"
 */
export function getGreeting(hour: number): string {
  if (hour >= 0 && hour < 12) {
    return "Good morning";
  } else if (hour >= 12 && hour < 18) {
    return "Good afternoon";
  } else {
    return "Good evening";
  }
}

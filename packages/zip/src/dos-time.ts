// ---------------------------------------------------------------------------
// DOS date/time ↔ JavaScript Date conversion.
//
// ZIP stores modification times as two 16-bit values in MS-DOS format:
//   Time: 5 bits hour, 6 bits minute, 5 bits second/2
//   Date: 7 bits year-1980, 4 bits month, 5 bits day
//
// Resolution is 2 seconds. Dates before 1980 clamp to 1980-01-01.
// ---------------------------------------------------------------------------

export function dateToDos(date: Date): { time: number; date: number } {
  const year = Math.max(date.getFullYear() - 1980, 0);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  return {
    time: (hours << 11) | (minutes << 5) | seconds,
    date: (year << 9) | (month << 5) | day,
  };
}

export function dosToDate(time: number, date: number): Date {
  const year = ((date >> 9) & 0x7f) + 1980;
  const month = ((date >> 5) & 0x0f) - 1;
  const day = date & 0x1f;
  const hours = (time >> 11) & 0x1f;
  const minutes = (time >> 5) & 0x3f;
  const seconds = (time & 0x1f) * 2;

  return new Date(year, month, day, hours, minutes, seconds);
}

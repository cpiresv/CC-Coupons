export const timezone = "Europe/Lisbon";
const months = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
export function lisbonParts(now = new Date()) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
}
export function localDay(now = new Date()) {
  const p = lisbonParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}
function dateKey(year, month, day) {
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (new Date(value + "T12:00:00Z").toISOString().slice(0, 10) !== value)
    throw new Error("INVALID_DATE");
  return value;
}
export function parseDateRange(text) {
  const m = text
    .trim()
    .toLowerCase()
    .match(
      /^de (\d{1,2})(?: de ([a-zç]+))?(?: de (\d{4}))? a (\d{1,2}) de ([a-zç]+) de (\d{4})$/u,
    );
  if (!m) throw new Error("UNKNOWN_DATE_FORMAT");
  const endMonth = months.indexOf(m[5]) + 1;
  const startMonth = m[2] ? months.indexOf(m[2]) + 1 : endMonth;
  if (!startMonth || !endMonth) throw new Error("UNKNOWN_MONTH");
  const endYear = Number(m[6]);
  const startYear = m[3]
    ? Number(m[3])
    : endYear - (startMonth > endMonth ? 1 : 0);
  const startDate = dateKey(startYear, startMonth, Number(m[1]));
  const endDate = dateKey(endYear, endMonth, Number(m[4]));
  if (startDate > endDate) throw new Error("INVALID_DATE_RANGE");
  return { startDate, endDate };
}
export function expiresAt(date) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const parts = lisbonParts(next);
  // Lisbon midnight has no DST transition; its UTC offset is zero or one hour.
  return next.getTime() - Number(parts.hour) * 3600000;
}
export function expiring(coupon, now = new Date()) {
  const left = expiresAt(coupon.endDate) - now.getTime();
  return left > 0 && left <= 48 * 3600000;
}
export function couponStatus(coupon, present, now = new Date()) {
  if (expiresAt(coupon.endDate) <= now.getTime()) return "expired";
  if (!present) return "removed";
  if (coupon.used === true) return "used";
  return coupon.startDate > localDay(now) ? "upcoming" : "available";
}

// 把日期格式化为 YYYY-MM-DD
export function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();
  return `${year}-${month}-${day}`;
}

export function isOverdue(due, now = new Date()) {
  return new Date(due) < now;
}

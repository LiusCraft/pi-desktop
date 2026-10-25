import { formatDate, isOverdue } from '../utils/date.js';

export default function TodoList({ todos, onToggle }) {
  return (
    <ul className="todo-list">
      {todos.map((t) => (
        <li key={t.id} className={isOverdue(t.due) ? 'overdue' : ''}>
          <input type="checkbox" checked={t.done} onChange={() => onToggle(t.id)} />
          <span>{t.title}</span>
          <time>{formatDate(t.due)}</time>
        </li>
      ))}
    </ul>
  );
}

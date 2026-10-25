import { useState } from 'react';
import TodoList from './components/TodoList.jsx';
import './styles.css';

export default function App() {
  const [todos, setTodos] = useState([]);
  const toggle = (id) =>
    setTodos((ts) => ts.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));

  return (
    <main className="app">
      <header>
        <h1>我的待办</h1>
      </header>
      <TodoList todos={todos} onToggle={toggle} />
    </main>
  );
}

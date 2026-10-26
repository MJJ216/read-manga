import { render } from 'preact';
import { App } from './App';
import './style.css';

render(<App />, document.getElementById('app')!);

if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

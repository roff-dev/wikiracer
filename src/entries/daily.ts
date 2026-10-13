import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import Daily from '../pages/Daily.svelte';

mount(Daily, { target: document.getElementById('app')! });

import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import { applyTheme } from '../data/theme';
import Daily from '../pages/Daily.svelte';

applyTheme();
mount(Daily, { target: document.getElementById('app')! });

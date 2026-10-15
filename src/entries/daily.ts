import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import { startBackdrop } from '../backdrop';
import { applyTheme } from '../data/theme';
import Daily from '../pages/Daily.svelte';

applyTheme();
startBackdrop();
mount(Daily, { target: document.getElementById('app')! });

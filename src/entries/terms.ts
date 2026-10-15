import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import { startBackdrop } from '../backdrop';
import { applyTheme } from '../data/theme';
import Terms from '../pages/Terms.svelte';

applyTheme();
startBackdrop();
mount(Terms, { target: document.getElementById('app')! });

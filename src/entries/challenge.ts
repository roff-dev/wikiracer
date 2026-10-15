import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import { startBackdrop } from '../backdrop';
import { applyTheme } from '../data/theme';
import Challenge from '../pages/Challenge.svelte';

applyTheme();
startBackdrop();
mount(Challenge, { target: document.getElementById('app')! });

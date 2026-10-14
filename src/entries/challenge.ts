import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import { applyTheme } from '../data/theme';
import Challenge from '../pages/Challenge.svelte';

applyTheme();
mount(Challenge, { target: document.getElementById('app')! });

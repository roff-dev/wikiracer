import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import { startBackdrop } from '../backdrop';
import { applyTheme } from '../data/theme';
import Race from '../pages/Race.svelte';

applyTheme();
startBackdrop();
mount(Race, { target: document.getElementById('app')! });

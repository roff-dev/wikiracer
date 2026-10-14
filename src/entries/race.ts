import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import { applyTheme } from '../data/theme';
import Race from '../pages/Race.svelte';

applyTheme();
mount(Race, { target: document.getElementById('app')! });

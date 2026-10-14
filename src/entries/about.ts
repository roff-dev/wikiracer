import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import { applyTheme } from '../data/theme';
import About from '../pages/About.svelte';

applyTheme();
mount(About, { target: document.getElementById('app')! });

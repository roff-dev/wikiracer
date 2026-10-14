import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import { applyTheme } from '../data/theme';
import Privacy from '../pages/Privacy.svelte';

applyTheme();
mount(Privacy, { target: document.getElementById('app')! });

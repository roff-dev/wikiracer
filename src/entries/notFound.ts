import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import { applyTheme } from '../data/theme';
import NotFound from '../pages/NotFound.svelte';

applyTheme();
mount(NotFound, { target: document.getElementById('app')! });

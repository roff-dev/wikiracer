import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import { startBackdrop } from '../backdrop';
import { applyTheme } from '../data/theme';
import NotFound from '../pages/NotFound.svelte';

applyTheme();
startBackdrop();
mount(NotFound, { target: document.getElementById('app')! });

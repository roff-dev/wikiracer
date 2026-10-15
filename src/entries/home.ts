import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import { startBackdrop } from '../backdrop';
import { applyTheme } from '../data/theme';
import Home from '../pages/Home.svelte';

applyTheme();
startBackdrop();
mount(Home, { target: document.getElementById('app')! });

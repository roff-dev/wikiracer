import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import { applyTheme } from '../data/theme';
import Home from '../pages/Home.svelte';

applyTheme();
mount(Home, { target: document.getElementById('app')! });

import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import { startBackdrop } from '../backdrop';
import { applyTheme } from '../data/theme';
import Result from '../pages/Result.svelte';

applyTheme();
startBackdrop();
mount(Result, { target: document.getElementById('app')! });

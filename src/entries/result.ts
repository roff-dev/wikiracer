import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import { applyTheme } from '../data/theme';
import Result from '../pages/Result.svelte';

applyTheme();
mount(Result, { target: document.getElementById('app')! });

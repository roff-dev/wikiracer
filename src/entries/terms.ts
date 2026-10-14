import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import { applyTheme } from '../data/theme';
import TextPage from '../pages/TextPage.svelte';

applyTheme();
mount(TextPage, { target: document.getElementById('app')!, props: { title: 'Terms' } });

import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import TextPage from '../pages/TextPage.svelte';

mount(TextPage, { target: document.getElementById('app')!, props: { title: 'About Wikiracer' } });

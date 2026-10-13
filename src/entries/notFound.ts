import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import NotFound from '../pages/NotFound.svelte';

mount(NotFound, { target: document.getElementById('app')! });

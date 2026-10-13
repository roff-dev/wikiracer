import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import Race from '../pages/Race.svelte';

mount(Race, { target: document.getElementById('app')! });

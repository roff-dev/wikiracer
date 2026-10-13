import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import Challenge from '../pages/Challenge.svelte';

mount(Challenge, { target: document.getElementById('app')! });

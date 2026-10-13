import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import Home from '../pages/Home.svelte';

mount(Home, { target: document.getElementById('app')! });

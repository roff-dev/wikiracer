import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import Result from '../pages/Result.svelte';

mount(Result, { target: document.getElementById('app')! });

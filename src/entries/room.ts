import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import Room from '../pages/Room.svelte';

mount(Room, { target: document.getElementById('app')! });

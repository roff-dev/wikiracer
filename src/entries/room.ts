import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/base.css';
import { mount } from 'svelte';
import { startBackdrop } from '../backdrop';
import { applyTheme } from '../data/theme';
import Room from '../pages/Room.svelte';

applyTheme();
startBackdrop();
mount(Room, { target: document.getElementById('app')! });

import { mount } from 'svelte';
import App from './BuildConfig.svelte';
import { VSCodeHooks } from './vscodeHooks';

// load tasklist
const vscodeHooks = VSCodeHooks.getInstance();

const app = mount(App, {
  target: document.getElementById('buildConfig')!,
  props: {
    vscodeHooks,
  },
});

export default app;

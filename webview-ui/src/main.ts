/*
	Licensed under the Apache License, Version 2.0 (the "License");
	you may not use this file except in compliance with the License.
	You may obtain a copy of the License at

		http://www.apache.org/licenses/LICENSE-2.0

	Unless required by applicable law or agreed to in writing, software
	distributed under the License is distributed on an "AS IS" BASIS,
	WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	See the License for the specific language governing permissions and
	limitations under the License.

	Copyright (c) 2024 Siddharth Purohit, CubePilot Global Pty Ltd.
*/

import { mount } from 'svelte';
import App from './BuildConfig.svelte';
import { VSCodeHooks } from './vscodeHooks';
import { installErrorHandler } from './utils/errorSourceMap';

// load tasklist
const vscodeHooks = VSCodeHooks.getInstance();

// Install the improved error handler first
installErrorHandler();

// Then initialize your application
const app = mount(App, {
  target: document.getElementById('buildConfig')!,
  props: {
    vscodeHooks,
  },
});

export default app;

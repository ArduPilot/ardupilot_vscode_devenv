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
import EnvironmentValidator from './EnvironmentValidator.svelte';
import { VSCodeHooks } from './vscodeHooks';
import { installErrorHandler } from './utils/errorSourceMap';

// Install the improved error handler first
installErrorHandler();

// Initialize VSCode hooks
const vscodeHooks = VSCodeHooks.getInstance();

// Mount the environment validator component
const app = mount(EnvironmentValidator, {
  target: document.getElementById('environmentValidator')!,
  props: {
    vscodeHooks,
  },
});

export default app;
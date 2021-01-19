# Ardupilot Development Environment
This extension is developed to provide set of tools to improve quality of life for devs using Visual Studio Code for development. Currently only basic function to generate build tasks is added. Contributions, recommendations and issue reports are welcome!

## Features

### Generate Ardupilot Build Tasks

![Ardupilot Build Tasks](images/ardupilot-tasks.gif)

## Task Configuration

Following is json schema of task configuration contributed by this extension:
```json
{
	"type": "ardupilot",
	"required": [
		"configure",
		"target"
	],
	"properties": {
		"configure": {
		"type": "string",
		"description": "Ardupilot board configuration"
		},
		"target": {
		"type": "string",
		"description": "Ardupilot binary target(s)"
		},
		"configureOptions": {
		"type": "string",
		"description": "waf configure option"
		},
		"buildOptions": {
		"type": "string",
		"description": "waf build option"
		},
		"waffile": {
		"type": "string",
		"description": "waf file location that can be omitted"
		}
	}
}
```

Sample `tasks.json`
```json
{
	"version": "2.0.0",
	"tasks": [
		{
			"type": "ardupilot",
			"configure": "CubeOrange",
			"target": "copter",
			"configureOptions": "--debug",
			"buildOptions": "--upload",
			"problemMatcher": [
				"$apgcc"
			],
			"label": "ardupilot: CubeOrange-copter",
			"group": {
				"kind": "build",
				"isDefault": true
			}
		}
	]
}
```



## Release Notes

### 0.0.1

* Add basic support of generating build tasks for ardupilot boards and vehicles

-----------------------------------------------------------------------------------------------------------

## Working with Ardupilot

Refer the docs [ArduPilot Development Site](https://ardupilot.org/dev/index.html)

**Enjoy!**

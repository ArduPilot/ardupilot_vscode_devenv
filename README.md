# Ardupilot Development Environment
This extension is developed to provide set of tools to improve quality of life for devs using Visual Studio Code for development. Currently only basic function to generate build tasks is added. Contributions, recommendations and issue reports are welcome!

## Features

### Generate Ardupilot Build Tasks

![Ardupilot Build Tasks](images/ardupilot-tasks.gif)

### Clone ArduPilot Repository
Easily clone the ArduPilot repository directly from within VS Code.

### Build Configuration Management
Create and manage build configurations for different ArduPilot boards and vehicles.

### Connected Devices Detection
Automatically detect and connect to ArduPilot devices plugged into your computer.

### SITL Simulation Support
Configure and run Software-In-The-Loop (SITL) simulations directly from VS Code.

### MAVProxy Integration
Connect to ArduPilot devices using MAVProxy directly from the extension.

### Environment Validation
Automatically validate your development environment and configure tool paths.

## Extension Usage Guide

### Getting Started

1. **Install the extension**
   - Install the ArduPilot Development Environment extension from the VS Code marketplace.
   - The extension will be activated automatically when VS Code starts.

2. **Clone ArduPilot Repository**
   - In the Activity Bar, click on the ArduPilot DevEnv icon.
   - In the Welcome view, click on the "Clone ArduPilot" option.
   - Select a directory where you want to clone the repository.
   - Enter a name for the directory (optional).
   - The extension will clone the repository and add it to your workspace.

3. **Open an Existing ArduPilot Repository**
   - Open a folder containing an ArduPilot repository in VS Code.
   - The extension will automatically detect the ArduPilot repository and enable its features.

### Validating Your Development Environment

1. **Access the Environment Validator**
   - In the Activity Bar, click on the ArduPilot DevEnv icon.
   - In the Welcome view, click on the "Validate Environment" option.
   - A new panel will open showing the validation status of required tools.

2. **Understanding the Validation Results**
   - The validator checks for the following tools:
     - **Python**: Required for running ArduPilot build scripts.
     - **MAVProxy**: Required for communicating with ArduPilot devices.
     - **arm-none-eabi-gcc**: Required for compiling ArduPilot firmware.
     - **arm-none-eabi-gdb / gdb-multiarch**: Required for debugging.
     - **ccache**: Recommended for faster build times.
     - **JLinkGDBServerCLExe**: Optional for SEGGER J-Link debugging.
     - **OpenOCD**: Optional for debugging various development boards.
   - Each tool will be marked as either "Available" or "Missing".
   - For available tools, the validator shows the version and path.

3. **Configuring Custom Tool Paths**
   - If a tool is detected as missing but you have it installed in a non-standard location:
     - Click the "Configure Path" button next to the tool.
     - Browse to select the executable file for the tool.
     - The validator will verify if the selected file is valid and executable.
     - The custom path will be saved and used for future operations.

4. **Reset Tool Paths**
   - To revert to default tool detection:
     - Click the "Reset All Paths" button at the bottom of the validator panel.
     - Confirm the reset when prompted.
     - The extension will revert to searching for tools in standard locations.

5. **CCache Setup Information**
   - The validator provides specific information about your ccache setup:
     - Shows if ccache is properly linked to compilers.
     - Provides guidance if the setup is incomplete.
     - Includes links to ArduPilot documentation about ccache configuration.

### Managing Build Configurations

1. **Create a New Build Configuration**
   - In the Activity Bar, click on the ArduPilot DevEnv icon.
   - In the Build Configurations view, click the "+" icon or click on "New Build Configuration" if no configurations exist.
   - In the configuration panel that opens:
     - Select a board (e.g., "CubeOrange", "SITL")
     - Select a target (e.g., "copter", "plane", "rover")
     - Add any configuration options if needed
     - For SITL builds, you can provide additional SITL configuration options
     - Optionally enable and configure features
   - Click "Create Build Configuration" to save the configuration.

2. **Edit an Existing Build Configuration**
   - In the Build Configurations view, find the configuration you want to edit.
   - Click the pencil icon next to the configuration or right-click and select "Edit".
   - Make your changes in the configuration panel.
   - Click "Save" to update the configuration.

3. **Delete a Build Configuration**
   - In the Build Configurations view, find the configuration you want to delete.
   - Click the trash icon next to the configuration or right-click and select "Delete".
   - Confirm the deletion when prompted.

4. **Build Firmware**
   - In the Build Configurations view, find the configuration you want to build.
   - Click the tools icon next to the configuration or right-click and select "Build Firmware".
   - The build process will start in a terminal window.
   - The extension will show a notification when the build completes successfully or fails.

### Working with Connected Devices

1. **View Connected Devices**
   - In the Activity Bar, click on the ArduPilot DevEnv icon.
   - Open the Connected Devices view to see a list of all connected USB devices.
   - Devices that are recognized as ArduPilot devices will be marked with a special icon.
   - If no devices appear, click the refresh button to scan for new devices.

2. **Connect to a Device using MAVProxy**
   - In the Connected Devices view, find the device you want to connect to.
   - Click on the "Connect MAVProxy" option for the device.
   - Enter the baud rate when prompted (default is 115200).
   - A terminal window will open running MAVProxy connected to your device.

3. **Disconnect from a Device**
   - In the Connected Devices view, find the connected device.
   - Click on the "Disconnect" option for the device.
   - The MAVProxy connection will be terminated.

### Software-In-The-Loop (SITL) Simulation

1. **Create a SITL Configuration**
   - Create a new build configuration as described above.
   - Select "SITL" as the board.
   - Select the vehicle type (e.g., "copter").
   - Add any SITL-specific options in the SITL Configuration section.
   - Click "Create Build Configuration" to save.

2. **Launch SITL Simulation**
   - After creating a SITL configuration, a matching debug configuration is automatically created.
   - Go to the Run and Debug view in VS Code (Ctrl+Shift+D).
   - Select the SITL launch configuration from the dropdown.
   - Click the Play button or press F5 to start the simulation.
   - The simulation will run in a terminal window.

### Debug Configuration

The extension automatically creates debug configurations to match your build configurations. These use the custom "apLaunch" debug type which can:

1. **For SITL configurations:**
   - Run the simulation using sim_vehicle.py with the configured options.

2. **For physical board configurations:**
   - Build and upload firmware to the board.

To use these configurations:
- Go to the Run and Debug view in VS Code (Ctrl+Shift+D).
- Select a configuration from the dropdown.
- Click the green Play button or press F5 to start debugging.

### Advanced Features

1. **Feature Configuration**
   - When creating or editing a build configuration, you can enable the Feature Configuration option.
   - This allows you to enable or disable specific ArduPilot features for your build.
   - Features are grouped by category and presented in a user-friendly interface.
   - Selected features will be stored in the board's feature list.

2. **Configure Build Options**
   - You can add custom configure options to your build configurations.
   - These options are passed to the waf configure command.
   - Common options include `--debug` for debug builds.

3. **Configure Build Task**
   - The extension creates VS Code tasks for your build configurations.
   - You can run these tasks from the Terminal menu: Terminal > Run Task...
   - Select a task with the format "ardupilot: [board]-[target]"

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

## Troubleshooting

### Build Configuration Issues
- Make sure your ArduPilot repository is properly set up.
- Check if the `waf` file exists in your repository root.
- Ensure Python 3 is installed and accessible.

### Device Connection Issues
- Make sure your device is properly connected to your computer.
- Check if you have the necessary permissions to access the device.
- Try refreshing the devices list.
- Verify MAVProxy is installed correctly.

### SITL Simulation Issues
- Make sure Python 3 is installed and accessible.
- Check if the simulation dependencies are installed.
- Verify that the ArduPilot repository is properly set up.

### Environment Validation Issues
- If tools are detected as missing despite being installed:
  - Use the "Configure Path" button to manually specify the tool location.
  - Make sure the tools are in your system PATH.
  - For Python, ensure you're using Python 3 (not Python 2).
- If custom paths are not being saved:
  - Check if you have write permissions for the workspace.
  - Try restarting VS Code after setting custom paths.
- For ccache-related issues:
  - Check the ArduPilot documentation for setting up ccache correctly.
  - On Linux, you may need to create symbolic links for your compilers.

## Release Notes

### 0.0.1

* Add basic support of generating build tasks for ardupilot boards and vehicles

-----------------------------------------------------------------------------------------------------------

## Working with Ardupilot

Refer the docs [ArduPilot Development Site](https://ardupilot.org/dev/index.html)

**Enjoy!**

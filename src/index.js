import parseCapabilities from 'desired-capabilities';
import childProcess from 'child_process';
import which from 'which';
import startSimulator from './start-simulator.js';

var isIdb = !!which.sync('idb_companion');

export default {
    // Multiple browsers support
    isMultiBrowser: true,

    currentBrowsers: {},

    async openBrowser (id, pageUrl, browserName) {
        var browserDetails = this._getBrowserDetails(browserName);
        var device = this._getDeviceFromDetails(browserDetails);

        if (device === null) 
            throw new Error('Could not find a valid iOS device to test on');

        this.currentBrowsers[id] = device;

        //If the device is not Shutdown we don't know what state it's in - shut it down and reboot it
        if (device.state !== 'Shutdown') {
            const shutdownCommand = isIdb ?
                'idb_companion --shutdown ' + device.udid :
                'fbsimctl ' + device.udid + ' shutdown';

            childProcess.execSync(shutdownCommand, { stdio: 'ignore' });
        }

        if (isIdb) 
            childProcess.execSync('idb_companion --boot ' + device.udid, { stdio: 'ignore' });
        else 
            await startSimulator(device);
        

        childProcess.execSync(`xcrun simctl openurl ${device.udid} ${pageUrl}`, { stdio: 'ignore' });
    },

    async closeBrowser (id) {
        var closeBrowserCommand = isIdb ?
            'idb_companion --shutdown ' + this.currentBrowsers[id].udid :
            'fbsimctl ' + this.currentBrowsers[id].udid + ' shutdown';

        childProcess.execSync(closeBrowserCommand, { stdio: 'ignore' });
    },


    // Optional - implement methods you need, remove other methods
    // Initialization
    async init () {
        await this._getAvailableDevices();
    },

    // Browser names handling
    async getBrowserList () {
        var devicesList = this._getSortedAvailableDevicesList();
        
        return devicesList.map(device => `${device.name}:${device.sdk}`);
    },

    async isValidBrowserName (browserName) {
        var browserDetails = this._getBrowserDetails(browserName);

        return this._getDeviceFromDetails(browserDetails) !== null;
    },

    // Extra methods
    async resizeWindow (/* id, width, height, currentWidth, currentHeight */) {
        this.reportWarning('The window resize functionality is not supported by the "fbsimctl" browser provider.');
    },

    async takeScreenshot (id, screenshotPath) {
        var command = 'xcrun simctl io ' + this.currentBrowsers[id].udid + ' screenshot \'' + screenshotPath + '\'';

        childProcess.execSync(command);
    },

    _getBrowserDetails (browserName) {
        return parseCapabilities(browserName)[0];
    },

    _getAvailableDevices () {
        //Get the list of available devices from fbsimctl's list command
        var listDevicesCommand = isIdb ? 
            'idb_companion --list 1' :
            'fbsimctl list';
        var rawDevices = childProcess.execSync(listDevicesCommand).toString().split('\n');
        var availableDevices = {};

        //Split each device entry apart on the separator, and build an object from the parts
        for (var entry of rawDevices) {
            var device;

            if (isIdb) {
                try {
                    var { udid, os_version:sdk, state, name } = JSON.parse(entry);
                }
                catch (e) {
                    // If JSON exception encountered, skip it.
                }

                device = { name, sdk, udid, state };
            }
            else {
                var parts = entry.split(' | ');

                device = { name: parts[3], sdk: parts[4], udid: parts[0], state: parts[2] };
            }

            //We can't run tests on tvOS or watchOS, so only include iOS devices
            if (device.sdk && device.sdk.startsWith('iOS')) {
                if (!availableDevices[device.sdk])
                    availableDevices[device.sdk] = []; 
                
                availableDevices[device.sdk].push(device);
            }
        }
        this.availableDevices = availableDevices;
    },

    _getSortedAvailableDevicesList () {
        const IOS_REPLACER = 'iOS ';

        /*return Object.keys(this.availableDevices)
            .map(device => parseFloat(device.replace(IOS_REPLACER, '')))
            .sort((a, b) => b - a)
            .reduce((acc, curr) => {
                var devicesOnPlatform = this.availableDevices[`${IOS_REPLACER}${curr}`];

                return devicesOnPlatform ? acc.concat[devicesOnPlatform] : devicesOnPlatform;
            }, []);*/
        
        const sortedKeys = [];

        for (var key of Object.keys(this.availableDevices)) 
            sortedKeys.push(key.replace(IOS_REPLACER, ''));
        
        sortedKeys.sort((a, b) => b - a);

        var sortedDevices = [];

        for (key of sortedKeys) 
            sortedDevices = sortedDevices.concat(this.availableDevices[`${IOS_REPLACER}${key}`] || []);
        
        return sortedDevices;
    },

    _getDeviceFromDetails ({ platform, browserName }) {
        // Do a lowercase match on the device they have asked for so we can be nice about iphone vs iPhone
        platform = platform.toLowerCase();
        browserName = browserName.toLowerCase();

        var devicesList = this._getSortedAvailableDevicesList();
        
        // If the user hasn't specified a platform, find all the available ones and choose the newest
        var matchedDevices = devicesList.filter(device => {
            return (platform === 'any' || platform === device.sdk.toLowerCase()) &&
                browserName === device.name.toLowerCase();
        });

        if (!matchedDevices.length)
            return null;

        return matchedDevices[0];
    }
};

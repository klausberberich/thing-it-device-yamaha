module.exports = {
    metadata: {
        family: "yamaha",
        plugin: "yamaha",
        label: "Yamaha",
        tangible: true,
        discoverable: true,
        state: [{
            id: "name",
            label: "Name",
            type: {
                id: "string"
            }
        }, {
            id: "modelName",
            label: "Model Name",
            type: {
                id: "string"
            }
        }, {
            id: "on",
            label: "On",
            type: {
                id: "boolean"
            }
        }, {
            id: "input",
            label: "Input",
            type: {
                id: "string"
            }
        }, {
            id: "inputName",
            label: "Input Name",
            type: {
                id: "string"
            }
        }, {
            id: "volume",
            label: "Volume",
            type: {
                id: "integer"
            }
        }, {
            id: "muted",
            label: "Muted",
            type: {
                id: "boolean"
            }
        }, {
            id: "pureDirect",
            label: "PureDirect",
            type: {
                id: "boolean"
            }
        }, {
            id: "availableInputs",
            label: "Available Inputs",
            type: {
                id: "Object"
            }
        }],
        actorTypes: [],
        sensorTypes: [],
        services: [{
            id: "powerOn",
            label: "Power On"
        }, {
            id: "powerOff",
            label: "Power Off"
        }, {
            id: "power",
            label: "power"
        }, {
            id: "mute",
            label: "Mute"
        }, {
            id: "setInput",
            label: "Set Input"
        }, {
            id: "setVolume",
            label: "Set Volume"
        }],
        configuration: [{
            id: "simulated",
            label: "Simulated",
            type: {
                id: "boolean"
            }
        }, {
            id: "host",
            label: "Host",
            type: {
                id: "string"
            }
        }, {
            id: "name",
            label: "Name",
            type: {
                id: "string"
            }
        }, {
            id: "updateInterval",
            label: "Update Interval",
            type: {
                id: "integer"
            },
            defaultValue: 1000
        }]
    },

    create: function (device) {
        return new Yamaha();
    },
    discovery: function (options) {
        var discovery = new YamahaDiscovery();

        discovery.options = options;

        return discovery;
    }
};

var q = require('q');
var YamahaNodeJs;


function YamahaDiscovery() {
    /**
     *
     * @param options
     */
    YamahaDiscovery.prototype.start = function () {
    };

    /**
     *
     * @param options
     */
    YamahaDiscovery.prototype.stop = function () {
    };
}

/**
 *
 */
function Yamaha() {
    Yamaha.prototype.initializeValues = function (){
        this.state = {
            name: null,
            modelName: null,
            on: false,
            input: null,
            volume: 0,
            muted: false,
            pureDirect: false,
            availableInputs: []
        };

        this.started = true;
        this.intervals = [];
        this.intervalCount = 0;
        this.simulationIntervals = [];
        this.simulationIntervalCount = 0;
        this.state.availableInputs = [];
        this.yamaha = null;
    }

    /**
     *
     */
    Yamaha.prototype.start = function () {
        var deferred = q.defer();
        this.initializeValues();
        this.configuration.updateInterval = ((!this.state.updateInterval || 1000 > this.configuration.updateInterval)
            ? 1000
            : this.configuration.updateInterval);
        this.ignoreUpdate = false;

        this.logDebug("Yamaha state: ", this.state);
        this.logDebug("Yamaha configuration: ", this.configuration);

        if (!this.isSimulated()) {
            this.logInfo("Starting up Yamaha.");

            if (!YamahaNodeJs) {
                YamahaNodeJs = require("yamaha-nodejs");
            }

            this.scan();
            deferred.resolve();
        } else {
            this.logInfo("Starting up simulated Yamaha.");
            deferred.resolve();
            this.initiateSimulation();
        }

        return deferred.promise;
    };

    Yamaha.prototype.stop = function (){
        this.started = false;
        this.logInfo("Stopping Yamaha AV Receiver " + this.state.name + " (" + this.configuration.host + ").");

        for (var index = 0; index < this.intervals.length; ++index) {
            clearInterval(this.intervals[index]);
        }

        for (var index = 0; index < this.simulationIntervals.length; ++index) {
            clearInterval(this.simulationIntervals[index]);
        }

        this.initializeValues();
    }

    /**
     *
     */
    Yamaha.prototype.scan = function () {
        this.logInfo("Scanning for Yamaha AV Receiver at host " + this.configuration.host + " started.");
        var deferred = q.defer();
        this.yamaha = new YamahaNodeJs(this.configuration.host);
        this.logInfo("Connected to host " + this.configuration.name + " (" + this.configuration.host + ").");
        this.state.name = this.configuration.name;
        deferred.resolve();
        this.connect();
        return deferred.promise;
    };

    /**
     *
     */
    Yamaha.prototype.readStatus = function () {
        var deferred = q.defer();
        this.logDebug("Reading status, ignore flag set to ", this.ignoreUpdate);

        if (this.started) {
            if (!this.isSimulated()) {
                if (!this.ignoreUpdate) {
                    this.yamaha.getBasicInfo().done(function (basicInfo) {
                        this.state.volume = Math.round(basicInfo.getVolume() / 10);
                        this.state.muted = Boolean(basicInfo.isMuted());
                        this.state.on = Boolean(basicInfo.isOn());
                        this.state.input = basicInfo.getCurrentInput();

                        // following code possibly specific to RX-V573
                        try {
                            var rawBasicStatus = basicInfo.YAMAHA_AV.Main_Zone[0].Basic_Status[0];

                                this.state.inputName = rawBasicStatus.Input[0].Input_Sel_Item_Info[0].Title[0];
                                this.state.pureDirect = "On" === rawBasicStatus.Sound_Video[0].Direct[0].Mode[0];
                        } catch (e) {
                            this.logError("Error during status read: " + e.message);
                            this.logError(e.stack);
                        }

                        this.publishStateChange();
                    }.bind(this));
                }
            }
            else {
                this.logDebug("Current state - on:" + this.state.on + ", input: " + this.state.input
                    + ", volume: " + this.state.volume + ", muted: " + this.state.muted);
                this.publishStateChange();
            }
        }

        deferred.resolve();
        return deferred.promise;
    }

    /**
     *
     */
    Yamaha.prototype.registerEvents = function () {
        var deferred = q.defer();
        this.logDebug("Initiating updates with interval", this.configuration.updateInterval);
        this.intervals[this.intervalCount++] = setInterval(Yamaha.prototype.readStatus.bind(this), this.configuration.updateInterval);
        deferred.resolve();
        return deferred.promise;
    }

    /**
     *
     */
    Yamaha.prototype.connect = function () {
        var deferred = q.defer();

        this.yamaha.getSystemConfig().done(function (config) {
            var deferred = q.defer();
            try {
                // Code possibly specific to RX-V573
                this.state.modelName = config.YAMAHA_AV.System[0].Config[0].Model_Name[0];
            } catch (e) {
                this.logError("Error reading model name", e);
            }

            var count = 0;

            // doesnt return AUDIO in the list, though it is available.
            // Code possibly specific to RX-V573
            this.state.availableInputs[count++] = {displayName: "AUDIO", id: "AUDIO"};

            try {
                // Code possibly specific to RX-V573
                for (var n in config.YAMAHA_AV.System[0].Config[0].Name[0].Input[0]) {
                    this.state.availableInputs[count++] = {
                        // Code possibly specific to RX-V573
                        displayName: config.YAMAHA_AV.System[0].Config[0].Name[0].Input[0][n][0].trim(),
                        id: n.replace("_", "")
                    };
                }

                this.logDebug("Found available inputs", this.state.availableInputs);
            } catch (e) {
                this.logError("Error reading inputs", e);
            }

            deferred.resolve();
            return deferred.promise;
        }.bind(this));

        // The following code kills Sonos devices on the same network and is therefore not used.
        /*
         this.yamaha.getAvailableInputs().done(function(inputs){
         this.logInfo(config);
         }.bind(this));
         */

        this.readStatus();
        this.registerEvents();
        deferred.resolve();
        return deferred.promise;
    }

    /**
     *
     */
    Yamaha.prototype.setState = function (state) {
        this.state = state;

        this.publishStateChange();
    };

    /**
     *
     */
    Yamaha.prototype.getState = function () {
        return this.state;
    };


    /**
     * Switch On
     */
    Yamaha.prototype.powerOn = function () {
        var deferred = q.defer();
        this.logDebug("Switching on");
        this.state.on = true;
        this.ignoreUpdate = true;
        setInterval(function () {
            this.ignoreUpdate = false;
        }.bind(this), 2500);
        this.publishStateChange();

        if (!this.isSimulated()) {
            this.yamaha.powerOn();
        }

        deferred.resolve();
        return deferred.promise;
    }

    /**
     * Switch Off
     */
    Yamaha.prototype.powerOff = function () {
        var deferred = q.defer();
        this.logDebug("Switching off");
        this.state.on = false;
        this.ignoreUpdate = true;
        setTimeout(function () {
            this.ignoreUpdate = false;
        }.bind(this), 2500);
        this.publishStateChange();

        if (!this.isSimulated()) {
            this.yamaha.powerOff();
        }

        deferred.resolve();
        return deferred.promise;
    }

    /**
     * Power (toggles power)
     */
    Yamaha.prototype.power = function () {
        var deferred = q.defer();
        /*
         @TODO figure out UI issue where the toggle switches back and forth
         */
        this.logDebug("Power On", this.state.on);
        if (this.state.on) {
            this.powerOff();
        }
        else {
            this.powerOn();
        }

        this.publishStateChange();

        deferred.resolve();
        return deferred.promise;
    }

    /**
     * Set input. Only allow inputs that are in the availableInputs state
     */
    Yamaha.prototype.setInput = function (input) {
        var deferred = q.defer();
        this.logDebug("Checking if  " + input + " is in input Array with length of "
            + this.state.availableInputs.length);

        for (index = 0; index < this.state.availableInputs.length; index++) {
            if (input == this.state.availableInputs[index].id) {
                this.logDebug("Setting input to " + this.state.availableInputs[index].displayName
                    + " (" + this.state.availableInputs[index].id + ").");
                this.state.input = this.state.availableInputs[index].id;
                this.state.inputName = this.state.availableInputs[index].displayName;

                if (!this.isSimulated()) {
                    this.yamaha.setMainInputTo(this.state.availableInputs[index].id);
                }

                break;
            }
        }

        this.publishStateChange();
        deferred.resolve();
        return deferred.promise;
    }

    /**
     *
     *
     */
    Yamaha.prototype.mute = function () {
        var deferred = q.defer();
        this.logDebug("Yamaha mute called");
        this.state.muted = !this.state.muted;

        if (!this.isSimulated()) {
            if (this.state.muted) {
                this.muteOn();
            }
            else {
                this.muteOff();
            }

        }

        this.publishStateChange();
        deferred.resolve();
        return deferred.promise;
    };

    Yamaha.prototype.muteOn = function() {
        var deferred = q.defer();
        this.setMute(true);
        deferred.resolve();
        return deferred.promise;
    }

    Yamaha.prototype.muteOff = function () {
        var deferred = q.defer();
        this.setMute(false);
        deferred.resolve();
        return deferred.promise;
    }

    Yamaha.prototype.setMute = function (muted){
        var deferred = q.defer();
        var modeString;

        if (muted){
            modeString = "On";
            this.state.muted = true;
        }
        else{
            modeString = "Off";
            this.state.muted = false;
        }

        // Code likely specific to RX-V573
        var xml = '<YAMAHA_AV cmd="PUT"><Main_Zone><Volume><Mute>' + modeString
            + '</Mute></Volume></Main_Zone></YAMAHA_AV>'
        this.yamaha.SendXMLToReceiver(xml);

        this.publishStateChange();
        deferred.resolve();
        return deferred.promise;
    }

    /**
     *
     *
     */
    Yamaha.prototype.isMuted = function () {
        return this.state.muted;
    }

    /**
     *
     *
     */
    Yamaha.prototype.pureDirect = function () {
        var deferred = q.defer();
        this.logDebug("Yamaha pureDirect called");
        this.state.pureDirect = !this.state.pureDirect;

        if (!this.isSimulated()) {
            if (this.state.pureDirect) {
                this.pureDirectOn();
            }
            else {
                this.pureDirectOff();
            }

        }

        this.publishStateChange();
        deferred.resolve();
        return deferred.promise;
    };

    Yamaha.prototype.pureDirectOn = function() {
        var deferred = q.defer();
        this.setPureDirect(true);
        deferred.resolve();
        return deferred.promise;
    }

    Yamaha.prototype.pureDirectOff = function () {
        var deferred = q.defer();
        this.setPureDirect(false);
        deferred.resolve();
        return deferred.promise;
    }

    Yamaha.prototype.setPureDirect = function (pureDirect){
        var deferred = q.defer();
        var modeString;

        if (pureDirect){
            modeString = "On";
            this.state.pureDirect = true;
        }
        else{
            modeString = "Off";
            this.state.pureDirect = false;
        }
        // Code likely specific to RX-V573
        var xml = '<YAMAHA_AV cmd="PUT"><Main_Zone><Sound_Video><Direct><Mode>' + modeString
            + '</Mode></Direct></Sound_Video></Main_Zone></YAMAHA_AV>';
        this.yamaha.SendXMLToReceiver(xml);
        this.publishStateChange();
        deferred.resolve();
        return deferred.promise;
    }

    /**
     *
     *
     */
    Yamaha.prototype.isPureDirect = function () {
        return this.state.pureDirect;
    }

    /**
     * Method to be used in conjunction with UI sliders.
     *
     */
    Yamaha.prototype.changeVolume = function (parameters) {
        var deferred = q.defer();
        this.logDebug("ChangeVolume called: ", parameters);
        this.setVolume(parameters.level);
        deferred.resolve();
        return deferred.promise;
    };


    /**
     *
     */
    Yamaha.prototype.setVolume = function (volume) {
        var deferred = q.defer();
        if (typeof volume === 'string' || volume instanceof String) {
            this.state.volume = parseInt(volume);
        }
        else
            this.state.volume = volume;

        if (!this.isSimulated()) {
            this.yamaha.setVolumeTo(this.state.volume * 10);
        }

        this.logDebug("Volume", this.state.volume, (typeof this.state.volume), volume);
        this.publishStateChange();
        deferred.resolve();
        return deferred.promise;
    }

    /**
     *
     *
     */
    Yamaha.prototype.initiateSimulation = function () {
        this.state = {
            name: this.configuration.name,
            modelName: "RX-V573",
            on: true,
            input: "HDMI1",
            volume: -25,
            muted: false,
            availableInputs: [
                {displayName: 'AUDIO', id: 'AUDIO'},
                {displayName: 'CABLE', id: 'HDMI1'},
                {displayName: 'RASPBMC', id: 'HDMI2'},
                {displayName: 'DVD', id: 'HDMI3'},
                {displayName: 'HDMI4', id: 'HDMI4'},
                {displayName: 'AV1', id: 'AV1'},
                {displayName: 'AV2', id: 'AV2'},
                {displayName: 'AV3', id: 'AV3'},
                {displayName: 'AV4', id: 'AV4'},
                {displayName: 'AV5', id: 'AV5'},
                {displayName: 'AV6', id: 'AV6'},
                {displayName: 'V-AUX', id: 'VAUX'},
                {displayName: 'USB', id: 'USB'}]
        };

        this.registerEvents();

        // toggle mute every 15 seconds
        this.simulationIntervals[this.simulationIntervalCount++] = setInterval(function () {
            this.logInfo("Simulated mute toggle.");
            this.mute();
        }.bind(this), 15000);

        // toggle it back 3 seconds later
        this.simulationIntervals[this.simulationIntervalCount++] = setInterval(function () {
            this.logInfo("Simulated mute toggle.");
            this.mute();
        }.bind(this), 18000);

        // switch input every 25 seconds
        this.simulationIntervals[this.simulationIntervalCount++] = setInterval(function () {
            this.logInfo("Simulated switch from " + this.state.input + " to AV5.");
            this.lastInput = this.state.input;
            this.setInput("AV5");
        }.bind(this), 25000);

        // toggle it back 3 seconds later
        this.simulationIntervals[this.simulationIntervalCount++] = setInterval(function () {
            this.logInfo("Simulated switch back to " + this.lastInput + ".");
            this.setInput(this.lastInput);
        }.bind(this), 28000);
    }
}

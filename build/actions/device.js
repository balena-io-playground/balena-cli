(function() {
  var commandOptions;

  commandOptions = require('./command-options');

  exports.list = {
    signature: 'devices',
    description: 'list all devices',
    help: 'Use this command to list all devices that belong to you.\n\nYou can filter the devices by application by using the `--application` option.\n\nExamples:\n\n	$ resin devices\n	$ resin devices --application MyApp\n	$ resin devices --app MyApp\n	$ resin devices -a MyApp',
    options: [commandOptions.optionalApplication],
    permission: 'user',
    primary: true,
    action: function(params, options, done) {
      var Promise, resin, visuals;
      Promise = require('bluebird');
      resin = require('resin-sdk');
      visuals = require('resin-cli-visuals');
      return Promise["try"](function() {
        if (options.application != null) {
          return resin.models.device.getAllByApplication(options.application);
        }
        return resin.models.device.getAll();
      }).tap(function(devices) {
        return console.log(visuals.table.horizontal(devices, ['id', 'uuid', 'name', 'device_type', 'application_name', 'status']));
      }).nodeify(done);
    }
  };

  exports.info = {
    signature: 'device <uuid>',
    description: 'list a single device',
    help: 'Use this command to show information about a single device.\n\nExamples:\n\n	$ resin device 7cf02a62a3a84440b1bb5579a3d57469148943278630b17e7fc6c4f7b465c9',
    permission: 'user',
    primary: true,
    action: function(params, options, done) {
      var events, resin, visuals;
      resin = require('resin-sdk');
      visuals = require('resin-cli-visuals');
      events = require('resin-cli-events');
      return resin.models.device.get(params.uuid).then(function(device) {
        if (device.last_seen == null) {
          device.last_seen = 'Not seen';
        }
        console.log(visuals.table.vertical(device, ["$" + device.name + "$", 'id', 'device_type', 'is_online', 'ip_address', 'application_name', 'status', 'last_seen', 'uuid', 'commit', 'supervisor_version', 'is_web_accessible', 'note']));
        return events.send('device.open', {
          device: device.uuid
        });
      }).nodeify(done);
    }
  };

  exports.register = {
    signature: 'device register <application>',
    description: 'register a device',
    help: 'Use this command to register a device to an application.\n\nExamples:\n\n	$ resin device register MyApp',
    permission: 'user',
    options: [
      {
        signature: 'uuid',
        description: 'custom uuid',
        parameter: 'uuid',
        alias: 'u'
      }
    ],
    action: function(params, options, done) {
      var Promise, resin;
      Promise = require('bluebird');
      resin = require('resin-sdk');
      return resin.models.application.get(params.application).then(function(application) {
        return Promise["try"](function() {
          return options.uuid || resin.models.device.generateUUID();
        }).then(function(uuid) {
          console.info("Registering to " + application.app_name + ": " + uuid);
          return resin.models.device.register(application.app_name, uuid);
        });
      }).get('uuid').nodeify(done);
    }
  };

  exports.remove = {
    signature: 'device rm <uuid>',
    description: 'remove a device',
    help: 'Use this command to remove a device from resin.io.\n\nNotice this command asks for confirmation interactively.\nYou can avoid this by passing the `--yes` boolean option.\n\nExamples:\n\n	$ resin device rm 7cf02a62a3a84440b1bb5579a3d57469148943278630b17e7fc6c4f7b465c9\n	$ resin device rm 7cf02a62a3a84440b1bb5579a3d57469148943278630b17e7fc6c4f7b465c9 --yes',
    options: [commandOptions.yes],
    permission: 'user',
    action: function(params, options, done) {
      var events, patterns, resin;
      resin = require('resin-sdk');
      events = require('resin-cli-events');
      patterns = require('../utils/patterns');
      return patterns.confirm(options.yes, 'Are you sure you want to delete the device?').then(function() {
        return resin.models.device.remove(params.uuid);
      }).tap(function() {
        return events.send('device.delete', {
          device: params.uuid
        });
      }).nodeify(done);
    }
  };

  exports.identify = {
    signature: 'device identify <uuid>',
    description: 'identify a device with a UUID',
    help: 'Use this command to identify a device.\n\nIn the Raspberry Pi, the ACT led is blinked several times.\n\nExamples:\n\n	$ resin device identify 23c73a12e3527df55c60b9ce647640c1b7da1b32d71e6a39849ac0f00db828',
    permission: 'user',
    action: function(params, options, done) {
      var resin;
      resin = require('resin-sdk');
      return resin.models.device.identify(params.uuid).nodeify(done);
    }
  };

  exports.rename = {
    signature: 'device rename <uuid> [newName]',
    description: 'rename a resin device',
    help: 'Use this command to rename a device.\n\nIf you omit the name, you\'ll get asked for it interactively.\n\nExamples:\n\n	$ resin device rename 7cf02a62a3a84440b1bb5579a3d57469148943278630b17e7fc6c4f7b465c9 MyPi\n	$ resin device rename 7cf02a62a3a84440b1bb5579a3d57469148943278630b17e7fc6c4f7b465c9',
    permission: 'user',
    action: function(params, options, done) {
      var Promise, _, events, form, resin;
      Promise = require('bluebird');
      _ = require('lodash');
      resin = require('resin-sdk');
      events = require('resin-cli-events');
      form = require('resin-cli-form');
      return Promise["try"](function() {
        if (!_.isEmpty(params.newName)) {
          return params.newName;
        }
        return form.ask({
          message: 'How do you want to name this device?',
          type: 'input'
        });
      }).then(_.partial(resin.models.device.rename, params.uuid)).tap(function() {
        return events.send('device.rename', {
          device: params.uuid
        });
      }).nodeify(done);
    }
  };

  exports.move = {
    signature: 'device move <uuid>',
    description: 'move a device to another application',
    help: 'Use this command to move a device to another application you own.\n\nIf you omit the application, you\'ll get asked for it interactively.\n\nExamples:\n\n	$ resin device move 7cf02a62a3a84440b1bb5579a3d57469148943278630b17e7fc6c4f7b465c9\n	$ resin device move 7cf02a62a3a84440b1bb5579a3d57469148943278630b17e7fc6c4f7b465c9 --application MyNewApp',
    permission: 'user',
    options: [commandOptions.optionalApplication],
    action: function(params, options, done) {
      var _, patterns, resin;
      resin = require('resin-sdk');
      _ = require('lodash');
      patterns = require('../utils/patterns');
      return resin.models.device.get(params.uuid).then(function(device) {
        return options.application || patterns.selectApplication(function(application) {
          return _.all([application.device_type === device.device_type, device.application_name !== application.app_name]);
        });
      }).tap(function(application) {
        return resin.models.device.move(params.uuid, application);
      }).then(function(application) {
        return console.info(params.uuid + " was moved to " + application);
      }).nodeify(done);
    }
  };

  exports.init = {
    signature: 'device init',
    description: 'initialise a device with resin os',
    help: 'Use this command to download the OS image of a certain application and write it to an SD Card.\n\nNotice this command may ask for confirmation interactively.\nYou can avoid this by passing the `--yes` boolean option.\n\nExamples:\n\n	$ resin device init\n	$ resin device init --application MyApp',
    options: [
      commandOptions.optionalApplication, commandOptions.yes, {
        signature: 'advanced',
        description: 'enable advanced configuration',
        boolean: true,
        alias: 'v'
      }
    ],
    permission: 'user',
    primary: true,
    action: function(params, options, done) {
      var Promise, capitano, helpers, patterns, resin, rimraf, tmp;
      Promise = require('bluebird');
      capitano = Promise.promisifyAll(require('capitano'));
      rimraf = Promise.promisify(require('rimraf'));
      tmp = Promise.promisifyAll(require('tmp'));
      tmp.setGracefulCleanup();
      resin = require('resin-sdk');
      helpers = require('../utils/helpers');
      patterns = require('../utils/patterns');
      return Promise["try"](function() {
        if (options.application != null) {
          return options.application;
        }
        return patterns.selectApplication();
      }).then(resin.models.application.get).then(function(application) {
        var download;
        download = function() {
          return tmp.tmpNameAsync().then(function(temporalPath) {
            return capitano.runAsync("os download " + application.device_type + " --output " + temporalPath);
          }).disposer(function(temporalPath) {
            return rimraf(temporalPath);
          });
        };
        return Promise.using(download(), function(temporalPath) {
          return capitano.runAsync("device register " + application.app_name).then(resin.models.device.get).tap(function(device) {
            var configure;
            configure = "os configure " + temporalPath + " " + device.uuid;
            if (options.advanced) {
              configure += ' --advanced';
            }
            return capitano.runAsync(configure).then(function() {
              var message;
              message = 'Initializing a device requires administration permissions\ngiven that we need to access raw devices directly.\n';
              return helpers.sudo(['os', 'initialize', temporalPath, '--type', application.device_type], message);
            });
          });
        }).then(function(device) {
          console.log('Done');
          return device.uuid;
        });
      }).nodeify(done);
    }
  };

}).call(this);

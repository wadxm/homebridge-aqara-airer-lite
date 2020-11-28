import {
  AccessoryPlugin,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  HAP,
  Logging,
  Service,
  CharacteristicEventTypes
} from "homebridge";
import {AqaraConnector} from "./aqara-connector";

export class AqaraAirerUpDown implements AccessoryPlugin {

  private readonly log: Logging;

  // This property must be existent!!
  name: string;

  private readonly upDownService: Service;
  private readonly informationService: Service;

  constructor(hap: HAP, log: Logging, name: string, connector: AqaraConnector) {
    this.log = log;
    this.name = name;

    this.upDownService = new hap.Service.WindowCovering(name);
    this.upDownService.getCharacteristic(hap.Characteristic.TargetPosition)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        log.info("Fetching target state of the airer level");
        connector.getAirerLevel().then(value => {
          log.info(`Target level get: ${value}`);
          callback(undefined, value);
        }).catch(e => {
          log.info(`Error getting level: ${e}`);
          callback(e);
        });
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        log.info(`Setting target state of the airer level: ${value}`);
        connector.setAirerLevel(value as number).then(succeeded => {
          log.info(`Setting target state of the airer level succeeded: ${succeeded}`);
          callback(succeeded ? undefined : new Error());
        });
      });

    this.upDownService.getCharacteristic(hap.Characteristic.CurrentPosition)
        .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
          log.info("Fetching current state of the airer level");
          connector.getEstimatedCurrentLevel().then(value => {
            log.info(`Current level get: ${value}`);
            callback(undefined, value);
          }).catch(e => {
            log.info(`Error getting level: ${e}`);
            callback(e);
          });
        });

    this.upDownService.getCharacteristic(hap.Characteristic.PositionState)
        .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
          log.info("Fetching position state of the airer level");
          connector.getStatePosition().then(value => {
            log.info(`Current position state get: ${value}`);
            callback(undefined, value);
          }).catch(e => {
            log.info(`Error getting position state: ${e}`);
            callback(e);
          });
        });

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, "Aqara")
      .setCharacteristic(hap.Characteristic.Model, "Aqara Airer Lite");

    log.info("Airer light '%s' created!", name);
  }

  /*
   * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
   * Typical this only ever happens at the pairing process.
   */
  identify(): void {
    this.log("Identify!");
  }

  /*
   * This method is called directly after creation of this instance.
   * It should return all services which should be added to the accessory.
   */
  getServices(): Service[] {
    return [
      this.informationService,
      this.upDownService,
    ];
  }

}

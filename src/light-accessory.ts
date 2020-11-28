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

export class AqaraAirerLight implements AccessoryPlugin {

  private readonly log: Logging;

  // This property must be existent!!
  name: string;

  private readonly lightService: Service;
  private readonly informationService: Service;

  constructor(hap: HAP, log: Logging, name: string, connector: AqaraConnector) {
    this.log = log;
    this.name = `${name} Light`;

    this.lightService = new hap.Service.Lightbulb(name);
    this.lightService.getCharacteristic(hap.Characteristic.On)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        log.info("Getting current light status...");
        connector.getAirerLightStatus().then(value => {
          log.info("Current light status was returned: " + (value? "ON": "OFF"));
          callback(undefined, value);
        });
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        log.info("Setting light status: " + (value? "ON": "OFF"));
        connector.setAirerLightStatus(value as boolean).then(succeeded => {
          log.info("Light status set succeeded: " + succeeded);
          callback(succeeded ? undefined : new Error());
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
      this.lightService,
    ];
  }

}

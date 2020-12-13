# homebridge-aqara-airer-lite
Homebridge Aqara Airer Lite plugin

## Introduction
If you have an Aqara Airer Lite, this plugin can turn it into a HomeKit light and a window cover separately. So you can turn its light on / off, set its up-down position (by setting the openning percentage) in HomeKit.

## Preparation
You need to register an Aqara open cloud app first (https://opencloud.aqara.cn), choose OAuth2 as your app type. After the app registeration reviewing (likely 24 hours), you will get your app ID and app secret.

## Installation
Insert the config into your homebridge config.json:
```
{
    "name": "Aqara Airer Lite",
    "platform": "aqara-airer-lite",
    "client_id": "", // your aqara open app id
    "client_secret": "", // your aqara open app secret
    "account": "", // your aqara account (likely phone number, which has an Aqara Airer Lite device binded to)
    "password": "" // your aqara account password
}
```

Then this plugin will automatically found the first Aqara Airer Lite device among the devices binded to your aqara account, and turn it into the HomeKit device.

 20896: (e, t, i) => {
        i.d(t, {
            A: () => f
        });
        var a = i(42686)
          , n = i(87512)
          , r = i(16265)
          , s = i(12115);
        let l = (0,
        a.t)("useBluetooth")
          , o = "53654010-a391-4a65-83fa-bc58084aca28"
          , c = "53654012-a391-4a65-83fa-bc58084aca28"
          , u = async (e, t) => {
            let i = await n.Ay.writeValue(o, "53654011-a391-4a65-83fa-bc58084aca28", new Uint8Array(e).buffer);
            return t && t(e, i),
            i
        }
          , d = async (e, t, i={
            timeout: 5e3
        }) => {
            let a = {
                hasResponse: !1,
                syncResponse: !0
            };
            u(e, (e, t) => a = {
                hasResponse: !0,
                syncResponse: t
            });
            let n = Math.ceil((i.timeout || 5e3) / 10);
            for (; n > 0 && !a.hasResponse; )
                await (0,
                r.y)(10),
                n -= 1;
            let s = n > 0;
            return s ? (t && t(e),
            await (0,
            r.y)(10)) : l.debug("[BLE_LOG] waitWriteValueResponse is timeout."),
            s ? a.syncResponse : null
        }
          , h = {
            status: null,
            puffSetting: null,
            serialNumber: null,
            advertisingName: null,
            latitude: null,
            longitude: null,
            lastUsingLat: null,
            lastUsingLng: null,
            lastUsingPrefecture: null,
            lastUsingCity: null,
            lastUsingStreet: null,
            lastUsedAt: null,
            lastUsingAddress: null,
            batteryDegradation: null,
            remainingBatteryLevel: null,
            chargeLogCount: 0,
            smokingLogCount: 0,
            geolocationPermission: !1,
            connectedAt: null,
            count: null,
            profileNumber: null,
            downloadProfileNumber: null,
            masterCorrection: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            masterCorrection1: [0, 0, 0, 0, 0, 0, 0, 0, 0],
            masterCorrection2: [0, 0, 0, 0, 0, 0, 0, 0, 0],
            masterCorrection3: [0, 0],
            version: "3.0",
            isLockingFunctionSetting: null,
            lockingStatus: null,
            firmwareVersion: null,
            dfuStatus: null,
            isSearching: !1,
            RSSI: null,
            lockPattern: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            sliderStatus: 1,
            frontPanelStatus: 0,
            latestError: null,
            errors: [],
            vapeTotalCount: null,
            extraErrors: [],
            batteryLevel: null,
            batteryCondition: [0, 0, 0, 0, 0],
            isLastVape: !1,
            hasConnectLogSent: !1,
            isAutoStartSet: !1,
            module: null
        }
          , g = {
            ...{
                available: !1,
                connected: !1,
                isConnecting: !1,
                isRequesting: !1,
                userDisconnected: !1,
                device: {
                    ...h
                }
            },
            device: {
                ...h
            }
        }
          , f = () => {
            let[,e] = (0,
            s.useState)(g)
              , t = async t => {
                e(g = t),
                await (0,
                r.y)(10)
            }
              , i = (0,
            s.useMemo)( () => ({
                setBluetoothAvailable: e => t({
                    ...g,
                    available: e.availability
                }),
                setBluetoothConnected: e => {
                    if (g.connected = e.connected,
                    g.device = e.device && {
                        ...g.device,
                        ...e.device
                    } || {
                        ...h
                    },
                    g.connected) {
                        g.userDisconnected = !1;
                        let e = n.Ay.mainFWVersion || ""
                          , t = e.indexOf("G4") > 0
                          , i = e.indexOf("G3.1") > 0;
                        g.device.version = `${t ? "4" : "3"}.${i ? "1" : "0"}`,
                        g.device.firmwareVersion = e?.replace(/( 000A|_G3.1|_G4).*/, ""),
                        i && (g.device.module = e.indexOf("G3.1_D") > 0 ? "DM" : "TA")
                    }
                    return t({
                        ...g
                    })
                }
                ,
                setBluetoothConnecting: e => t({
                    ...g,
                    isConnecting: e.isConnecting
                }),
                setBluetoothRequesting: e => t({
                    ...g,
                    isRequesting: e.isRequesting
                }),
                setBluetoothUserDisconnected: e => t({
                    ...g,
                    userDisconnected: e.userDisconnected
                }),
                setBluetoothDevice: e => t({
                    ...g,
                    device: {
                        ...g.device,
                        ...e.device
                    }
                }),
                setMasterCorrection: e => {
                    let i = Object.keys(e)[0];
                    return t({
                        ...g,
                        device: {
                            ...g.device,
                            [i]: e[i]
                        }
                    })
                }
                ,
                requestInitSeq: e => {
                    let {handler: t} = e;
                    u([2, 227, 0], t)
                }
                ,
                setDfuMode: e => {
                    let {handler: t} = e;
                    u([2, 255, 0], t)
                }
                ,
                setLockSetting: e => {
                    let {handler: t, enabled: i} = e
                      , a = [12, 160, 1]
                      , n = g.device
                      , r = n.version >= "3.1" ? [...a, ...n.lockPattern?.some(e => 0 !== e) ? n.lockPattern : [1, 2, 3, 1, 2, 3, 0, 0, 0, 0]] : [...a, 1, 2, 1, 2, 1, 2, 1, 2, 3, 0];
                    u(i ? r : [12, 160, 0, ...n.lockPattern || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], t)
                }
                ,
                setLockStatus: e => {
                    let {handler: t, enabled: i} = e;
                    u([2, 158, +!!i], t)
                }
                ,
                setBluetoothSetting: e => {
                    let {handler: t, enabled: i} = e;
                    u([2, 161, +!!i], t)
                }
                ,
                getProfileNumber: e => {
                    let {handler: t} = e;
                    u([2, 162, 0], t)
                }
                ,
                getDownloadProfileNumber: e => {
                    let {handler: t} = e;
                    u([2, 163, 0], t)
                }
                ,
                setProfileNumber: e => {
                    let {handler: t, number: i} = e;
                    u([2, 164, i], t)
                }
                ,
                getMasterNumber: e => {
                    let {handler: t} = e;
                    u([2, 165, 0], t)
                }
                ,
                resetProfileNumber: e => {
                    let {handler: t} = e;
                    u([2, 166, 0], t)
                }
                ,
                writeProfileRow: e => {
                    let {cmd: t, handler: i} = e;
                    u(t, i)
                }
                ,
                setHeatingProfile: async e => {
                    let {handler: t, writeFinished: i= () => {}
                    , writeFailed: a= () => {}
                    , cmds: n} = e;
                    for (let e = 0; e < n.length; e += 1) {
                        l.debug(`setHeatingProfile: step${e} ${n[e]}`);
                        let i = await d(n[e], t);
                        if (null === i) {
                            l.debug(`setHeatingProfile: step${e} is FAILED`),
                            a();
                            return
                        }
                        i || await (0,
                        r.y)(100)
                    }
                    l.debug("setHeatingProfile is finished"),
                    i()
                }
                ,
                setDeviceRegistration: e => {
                    let {handler: t, registered: i} = e;
                    u([2, 191, +!!i], t)
                }
                ,
                setPuffSetting: e => {
                    let {handler: t, enabled: i} = e;
                    u([2, 192, +!!i], t)
                }
                ,
                requestSmokingLog: e => {
                    let {handler: t} = e;
                    u([2, 193, 0], t)
                }
                ,
                requestChargeLog: e => {
                    let {handler: t} = e;
                    u([2, 194, 0], t)
                }
                ,
                setSmokingLogFinished: e => {
                    let {handler: t} = e;
                    u([2, 195, 0], t)
                }
                ,
                markAsLogRetrieved: e => {
                    let {handler: t} = e;
                    u([2, 195, 0], t)
                }
                ,
                setLogDeletePermission: e => {
                    let {handler: t} = e;
                    u([2, 196, 0], t)
                }
                ,
                setLogDeletePermission2: e => {
                    let {handler: t} = e;
                    u([2, 197, 0], t)
                }
                ,
                requestChargeCondition: e => {
                    let {handler: t} = e;
                    u([2, 124, 0], t)
                }
                ,
                requestLastStickCheck: e => {
                    let {handler: t} = e;
                    u([2, 123, 0], t)
                }
                ,
                requestErrorLog: e => {
                    let {handler: t, index: i} = e;
                    u([2, 211, i], t)
                }
                ,
                requestErrorLogInfo: e => {
                    let {handler: t} = e;
                    u([2, 243, 0], t)
                }
                ,
                requestLogExtraInfo: e => {
                    let {handler: t, type: i=0, registerAddress: a=255, smokingUsageLogNumber: n=65535} = e;
                    u([4, 241, i, ...4 === i ? [a, 255] : new Uint8Array(new Uint16Array([n]).buffer)], t)
                }
                ,
                setSmokingAssist: e => {
                    let {handler: t, enabled: i} = e;
                    u([2, 198, +!!i], t)
                }
                ,
                getProductId: e => {
                    let {handler: t} = e;
                    u([2, 225, 0], t)
                }
                ,
                getDeviceVariation: e => {
                    let {handler: t} = e;
                    u([2, 224, 0], t)
                }
                ,
                setHeatAutoStart: e => {
                    let {handler: t, enabled: i} = e;
                    u([2, 202, +!!i], t)
                }
                ,
                setStickDetect1: e => {
                    let {handler: t, cmd: i} = e;
                    u(i, t)
                }
                ,
                setStickDetect2: e => {
                    let {handler: t, cmd: i} = e;
                    u(i, t)
                }
                ,
                setStickFalseDetect1: e => {
                    let {handler: t, cmd: i} = e;
                    u(i, t)
                }
                ,
                setStickFalseDetect2: e => {
                    let {handler: t, cmd: i} = e;
                    u(i, t)
                }
                ,
                getStickDetect1: e => {
                    let {handler: t, dest: i} = e;
                    u([2, 207, i], t)
                }
                ,
                getStickDetect2: e => {
                    let {handler: t, dest: i} = e;
                    u([2, 208, i], t)
                }
                ,
                getStickFalseDetect1: e => {
                    let {handler: t, dest: i} = e;
                    u([2, 209, i], t)
                }
                ,
                getStickFalseDetect2: e => {
                    let {handler: t, dest: i} = e;
                    u([2, 210, i], t)
                }
                ,
                getRSSI: e => {
                    let {handler: t} = e;
                    u([2, 253, 0], t)
                }
                ,
                requestVibration: e => {
                    let {handler: t, enabled: i} = e;
                    u([2, 121, +!!i], t)
                }
                ,
                startIndicationForDashboard: async e => {
                    let {handler: t} = e;
                    return await n.Ay.startNotifications(o, c, e => {
                        let {value: i=new DataView(new ArrayBuffer(2))} = e.target;
                        t({
                            cmd: i.getUint8(1).toString(16).toUpperCase(),
                            value: i
                        })
                    }
                    )
                }
                ,
                stopIndication: () => {
                    n.Ay.stopNotifications(o, c)
                }
            }), []);
            return [g, i]
        }
    }
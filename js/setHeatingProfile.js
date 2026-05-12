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
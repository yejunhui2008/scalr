Scalr.regPage('Scalr.ui.servers.view', function (loadParams, moduleParams) {
	var store = Ext.create('store.store', {
		fields: [
			'cloud_location', 'flavor', 'instance_type_name', 'cloud_server_id', 'excluded_from_dns', 'server_id', 'remote_ip', 'role_alias',
			'local_ip', 'status', 'platform', 'farm_name', 'role_name', 'index', 'role_id', 'farm_id', 'farm_roleid',
			'uptime', 'ismaster', 'os_family', 'has_eip', 'is_szr', 'cluster_position', 'agent_version', 'agent_update_needed', 'agent_update_manual',
			'initDetailsSupported', 'isInitFailed', 'la_server', 'launch_error', 'alerts', 'cluster_role', 'is_locked', 'hostname', 'termination_error'
		],
		proxy: {
			type: 'scalr.paging',
			url: '/servers/xListServers/'
		},
		remoteSort: true
	});

	var laStore = Ext.create('store.store', {
		fields: [ 'server_id', 'la', 'time' ],
		proxy: 'object'
	});

	var updateHandler = {
		id: 0,
		timeout: 15000,
		running: false,
		schedule: function (run) {
			this.running = Ext.isDefined(run) ? run : this.running;

			clearTimeout(this.id);
			if (this.running)
				this.id = Ext.Function.defer(this.start, this.timeout, this);
		},
		start: function () {
			var list = [];

			if (! this.running)
				return;

			store.each(function (r) {
				if (r.get('status') != 'Terminated')
					list.push(r.get('server_id'));
			});

			if (! list.length) {
				this.schedule();
				return;
			}

			Scalr.Request({
				url: '/servers/xListServersUpdate/',
				params: {
					servers: Ext.encode(list)
				},
				success: function (data) {
					for (var serverId in data.servers) {
						var r = store.findRecord('server_id', serverId);
						if (r) {
							r.set(data.servers[serverId]);
							r.commit();
						}
					}
					this.schedule();
				},
				failure: function () {
					this.schedule();
				},
				scope :this
			});
		}
	};
	store.on('load', function() {
		// reset to start
		this.schedule(true);
	}, updateHandler);

	var laHandler = {
		id: 0,
		timeout: 60000,
		running: false,
		cache: {},
		updateEvent: function () {
			laStore.removeAll();
			this.schedule(this.running, true);
		},
		schedule: function (run, start) {
			this.running = Ext.isDefined(run) ? run : this.running;
			start = start == true ? 0 : this.timeout;

			clearTimeout(this.id);
			if (this.running)
				this.id = Ext.Function.defer(this.start, start, this);
		},
		start: function () {
			var dt = new Date();

			if (! this.running)
				return;

			for (var i = 0; i < store.getCount(); i++) {
				var r = store.getAt(i);

				if (r.get('status') == 'Running') {
					var la = laStore.findRecord('server_id', r.get('server_id'));

					if (!la || (la.get('time') > dt)) {
						r.set('la_server', '<img src="/ui2/images/icons/anim/snake_16x16.gif">');
						r.commit();
						if (! la)
							la = laStore.add({ server_id: r.get('server_id') })[0];

						Scalr.Request({
							url: '/servers/xServerGetLa/',
							params: { serverId: r.get('server_id') },
							success: function (data) {
								r.set({
									'la_server': data.la
								});
								r.commit();
								la.set({
									'time': Ext.Date.add(new Date(), Date.MINUTE, 3),
									'la': data.la
								});
								la.commit();
								Ext.Function.defer(this.start, 50, this);
							},
							failure: function (data) {
								r.set({
									'la_server': '<img src="/ui2/images/icons/warning_icon_16x16.png" title="' + (data && data.errorMessage || 'Cannot proceed request') + '">'
								});
								r.commit();
								la.set({
									'time': Ext.Date.add(new Date(), Date.MINUTE, 3),
									'la': data && data.la
								});
								la.commit();
								Ext.Function.defer(this.start, 50, this);
							},
							scope: this
						});
						return false;
					} else {
						r.set('la_server', la.get('la'));
						r.commit();
					}
				} else {
					r.set('la_server', '-');
					r.commit();
				}
			}
			this.schedule();
		}
	};
	store.on('load', laHandler.updateEvent, laHandler);

	return Ext.create('Ext.grid.Panel', {
		title: 'Servers &raquo; View',
		scalrOptions: {
			'reload': false,
			'maximize': 'all'
		},
		store: store,
		stateId: 'grid-servers-view',
		stateful: true,
		plugins: {
			ptype: 'gridstore'
		},

		tools: [{
			xtype: 'gridcolumnstool'
		}, {
			xtype: 'favoritetool',
			favorite: {
				text: 'Servers',
				href: '#/servers/view'
			}
		}],

		viewConfig: {
			emptyText: 'No servers found',
			loadingText: 'Loading servers ...',
			getRowClass: function (record, rowIndex, rowParams) {
				//TODO: replace == 9999 with > 0 when ready
				return (!record.get('is_szr') && record.get('status') == 'Running') || (record.get('alerts') > 0) ? 'x-grid-row-red' : '';
			},
			listeners: {
				itemclick: function (view, record, item, index, e) {
					if (e.getTarget('a.updateAgent')) {
						Scalr.Request({
							processBox: {
								type: 'action'
							},
							url: e.getTarget('a.updateAgent').href
						})
						e.preventDefault();
					} else if (e.getTarget('img.lock')) {
                        Scalr.Request({
                            processBox: {
                                type: 'action'
                            },
                            confirmBox: {
                                type: 'action',
                                msg: 'Reset disableAPITermination flag for server "' + record.get('server_id') + '"?'
                            },
                            url: '/servers/xLock',
                            params: {
                                serverId: record.get('server_id')
                            },
                            success: function() {
                                store.load();
                            }
                        })
                    }
				}
			}
		},

		columns: [
			{ header: "Cloud", width: 80, dataIndex: 'platform', sortable: true, align: 'left', xtype: 'templatecolumn', tdCls: 'scalr-ui-servers-view-column-platform', tpl:
                '<img class="x-icon-platform-small x-icon-platform-small-{platform}" title="{platform}" src="' + Ext.BLANK_IMAGE_URL + '"/>'
            },
			{ header: "Farm & role", flex: 2, dataIndex: 'farm_name', sortable: true, xtype: 'templatecolumn',
			    doSort: function (state) {
			        var ds = this.up('tablepanel').store;
			        ds.sort([{
			            property: 'farm_name',
			            direction: state
			        }, {
			            property: 'role_alias',
			            direction: state
			        }, {
			            property: 'index',
			            direction: state
			        }]);
			    }, tpl:
				'<tpl if="farm_id">' +
					'<a href="#/farms/view?farmId={farm_id}" title="Farm {farm_name}">{farm_name}</a>' +
					'<tpl if="role_alias">' +
                        '&nbsp;&rarr;&nbsp;<a href="#/farms/{farm_id}/roles/{farm_roleid}/view" title="Role {role_alias}">{role_alias}</a> ' +
                    '</tpl>' +
					'<tpl if="role_name && !role_alias">' +
						'&nbsp;&rarr;&nbsp;<a href="#/farms/{farm_id}/roles/{farm_roleid}/view" title="Role {role_name}">{role_name}</a> ' +
					'</tpl>' +
					'<tpl if="!role_name && !role_alias">' +
						'&nbsp;&rarr;&nbsp;*removed role*&nbsp;' +
					'</tpl>' +
					'#<a href="#/servers/{server_id}/view">{index}</a>'+
				'</tpl>' +
				'<tpl if="cluster_role"> ({cluster_role})</tpl>' +
				'<tpl if="cluster_position"> ({cluster_position})</tpl>' +
				'<tpl if="! farm_id"><img src="' + Ext.BLANK_IMAGE_URL + '" class="x-icon-minus" /></tpl>'
			},
			{ header: "Server ID", flex: 1, dataIndex: 'server_id', sortable: true, xtype: 'templatecolumn', tpl: new Ext.XTemplate(
				'<tpl if="!is_szr && status == \'Running\'">' +
                    '<a href="http://blog.scalr.com/post/53324376570/ami-scripts" target="_blank"><img src="' + Ext.BLANK_IMAGE_URL + '" class="x-icon-error"  title="This server using old (deprecated) scalr agent. Please click here for more informating about how to upgrade it." /></a>&nbsp;' +
                '</tpl>' +
                '<tpl if="alerts &gt; 0">' +
                    '<a href="#/alerts?serverId={server_id}"><img src="' + Ext.BLANK_IMAGE_URL + '" class="x-icon-error" title="{alerts} alert(s). Click for more information." /></a>&nbsp;' +
                '</tpl>' +
				'<a href="#/servers/{server_id}/dashboard">{[this.serverId(values.server_id)]}</a>'
                ,{
					serverId: function(id) {
						var values = id.split('-');
						return values[0] + '-...-' + values[values.length - 1];
					}
				})
			},
            { header: "Hostname", flex: 1, dataIndex: 'hostname', sortable: false, hidden: true, xtype: 'templatecolumn',
				tpl: '<tpl if="hostname">{hostname}<tpl else><img src="' + Ext.BLANK_IMAGE_URL + '" class="x-icon-minus" /></tpl>'
			},
			{ header: "Cloud Server ID", width: 100, dataIndex: 'cloud_server_id', sortable: false, hidden: true, xtype:'templatecolumn',  tpl:
				'<tpl if="cloud_server_id">{cloud_server_id}' +
				'<tpl else><img src="' + Ext.BLANK_IMAGE_URL + '" class="x-icon-minus" /></tpl>'
			},
			{ header: "Cloud Location", width: 100, dataIndex: 'cloud_location', sortable: false, hidden: true },
			{ header: "Status", minWidth: 160, width: 160, dataIndex: 'status', sortable: true, xtype: 'statuscolumn', statustype: 'server', qtipConfig: {width: 300}},
			{ header: 'Type', width: 100, dataIndex: 'flavor', sortable: false, hidden: true, xtype: 'templatecolumn', tpl: '{[values.instance_type_name||values.flavor]}' },
			{ header: "Public IP", width: 120, dataIndex: 'remote_ip', sortable: true, xtype: 'templatecolumn', tpl:
				'<tpl if="remote_ip">' +
				'<tpl if="has_eip"><span style="color:green;">{remote_ip} <img title="Elastic IP" src="/ui2/images/icons/elastic_ip.png" /></span></tpl><tpl if="!has_eip">{remote_ip}</tpl>' +
				'</tpl>'
			},
			{ header: "Private IP", width: 120, dataIndex: 'local_ip', sortable: true, xtype: 'templatecolumn', tpl:
				'<tpl if="local_ip">{local_ip}</tpl>'
			},
			{ header: "Uptime", width: 200, dataIndex: 'uptime', sortable: false },
			{ header: "DNS", width: 38, dataIndex: 'excluded_from_dns', sortable: false, xtype: 'templatecolumn', align: 'center', tpl:
				'<img src="' + Ext.BLANK_IMAGE_URL + '" class="x-icon-<tpl if="excluded_from_dns">minus<tpl else>ok</tpl>"/>'
			},
			{ header: "LA", width: 50, dataIndex: 'la_server', itemId: 'la', sortable: false, hidden: true, align: 'center',
				listeners: {
					hide: function () {
						laHandler.schedule(false);
					},
					show: function () {
                        // grid column is hidden and may doesn't exist, let give it time. May be bug in 4.2
                        setTimeout(function () {
                            laHandler.schedule(true, true);
                        }, 100);
					}
				}
			},
			{ header: "Agent", width: 80, dataIndex: 'agent_version', sortable: false, xtype: 'templatecolumn',  align: 'center', tpl:
				'<tpl if="(status == &quot;Running&quot; || status == &quot;Initializing&quot;)">' +
                    '<tpl if="agent_update_needed">' +
                        '<a class="updateAgent" href="/servers/{server_id}/xUpdateAgent"><img src="/ui2/images/icons/warning_16x16.png" width="12" title="Your scalr agent version is too old. Please click here to update it to the latest version."></a> {agent_version}' +
                    '</tpl>'+
                    '<tpl if="agent_update_manual">' +
                        '<a href="http://blog.scalr.com/post/53324376570/ami-scripts" target="_blank"><img src="/ui2/images/icons/error_icon_16x16.png" width="12" title="This server using old (deprecated) scalr agent. Please click here for more informating about how to upgrade it."></a> {agent_version}' +
                     '</tpl>'+
                    '<tpl if="!agent_update_needed && !agent_update_manual">{agent_version}</tpl>' +
				'</tpl>' + 
                '<tpl if="!(status == &quot;Running&quot; || status == &quot;Initializing&quot;)"><img src="' + Ext.BLANK_IMAGE_URL + '" class="x-icon-minus" /></tpl>'
			},
			{ header: "Actions", width: 96, minWidth: 96, fixed: true, dataIndex: 'id', sortable: false, hideable: false, align: 'center', xtype: 'templatecolumn', tpl: new Ext.XTemplate(
                '<div style="position: relative; height: 16px;">' +
                    '<tpl if="(status == \'Running\' || status == \'Initializing\') && index != \'0\'">' +
                        ( moduleParams['mindtermEnabled'] ? '<tpl if="os_family != \'windows\'">' +
                            '<a title="SSH Launcher" href="#/servers/{server_id}/sshConsole" style="float:left"><img src="' + Ext.BLANK_IMAGE_URL + '" class="x-icon-server-action x-icon-server-action-console" /></a>' +
                        '</tpl>' : '<img src="' + Ext.BLANK_IMAGE_URL + '" style="width: 16px; float: left">') +
                        '<a title="Monitoring" href="#/monitoring/view?farmId={farm_id}&farmRoleId={farm_roleid}&index={index}" style="float:left;margin:0 6px"><img src="' + Ext.BLANK_IMAGE_URL + '" class="x-icon-server-action x-icon-server-action-statsusage" /></a>' +
                        '<a title="Execute script" href="#/scripts/execute?serverId={server_id}" style="float:left"><img src="' + Ext.BLANK_IMAGE_URL + '" class="x-icon-server-action x-icon-server-action-execute" /></a>' +
                    '</tpl>' +
                    '<tpl if="is_locked == 1">' +
                        '<img src="' + Ext.BLANK_IMAGE_URL + '" class="x-icon-server-action x-icon-server-action-lock lock" title="disableAPITermination flag is set to ON. Click to remove." style="cursor:pointer;margin-left:6px" />' +
                    '</tpl>' +
                    '<tpl if="is_locked != 1 && !((status == \'Running\' || status == \'Initializing\') && index != \'0\')">' +
                        '<img src="' + Ext.BLANK_IMAGE_URL + '" class="x-icon-minus"/>' +
                    '</tpl>' +
                '</div>')
            },{
				xtype: 'optionscolumn2',
                menu: {
                    xtype: 'servermenu',
                    listeners: {
                        actioncomplete: function() {
                            store.load();
                        }
                    }
                }
			}
		],

		multiSelect: true,
		selModel: {
			selType: 'selectedmodel',
			getVisibility: function(record) {
				return (record.get('status') === 'Running' || record.get('status') === 'Initializing');
			}
		},

		listeners: {
			activate: function () {
				updateHandler.schedule(true);
				laHandler.schedule(! this.headerCt.down('#la').isHidden(), true);
			},
			deactivate: function () {
				updateHandler.schedule(false);
				laHandler.schedule(false);
			},
			selectionchange: function(selModel, selections) {
				this.down('scalrpagingtoolbar').down('#reboot').setDisabled(!selections.length);
				this.down('scalrpagingtoolbar').down('#terminate').setDisabled(!selections.length);
			}
		},

		dockedItems: [{
			xtype: 'scalrpagingtoolbar',
			store: store,
			dock: 'top',
			afterItems: [{
				ui: 'paging',
				itemId: 'reboot',
				iconCls: 'x-tbar-reboot',
				tooltip: 'Select one or more servers to reboot them',
				disabled: true,
				handler: function() {
					var records = this.up('grid').getSelectionModel().getSelection(),
                        servers = [];

					for (var i = 0, len = records.length; i < len; i++) {
						servers.push(records[i].get('server_id'));
					}

                    Scalr.cache['Scalr.ui.servers.reboot'](servers, function() {
                        store.load();
                    });
				}
			}, {
				ui: 'paging',
				itemId: 'terminate',
				iconCls: 'x-tbar-terminate',
				tooltip: 'Select one or more servers to terminate them',
				disabled: true,
				handler: function() {
					var forcefulDisabledCount = 0,
                        forcefulDisabled,
                        platform,
                        records = this.up('grid').getSelectionModel().getSelection(),
                        servers = [];

					for (var i = 0, len = records.length; i < len; i++) {
                        platform = records[i].get('platform');
						servers.push(records[i].get('server_id'));
                        if (Scalr.isOpenstack(platform, true) || platform === 'cloudstack') {
                            forcefulDisabledCount++;
                        }
					}

                    forcefulDisabled = records.length === forcefulDisabledCount ? true : (forcefulDisabledCount>0 ? 'partial' : false);

                    Scalr.cache['Scalr.ui.servers.terminate'](servers, forcefulDisabled, function() {
                        store.load();
                    });
				}
			}],
			items: [{
				xtype: 'filterfield',
				width: 300,
				form: {
					items: [{
						xtype: 'textfield',
						fieldLabel: 'Cloud server id',
						labelAlign: 'top',
						name: 'cloudServerId'
					}, {
						xtype: 'textfield',
						fieldLabel: 'Cloud server location',
						labelAlign: 'top',
						name: 'cloudServerLocation'
					}, {
                        xtype: 'textfield',
                        fieldLabel: 'Hostname',
                        labelAlign: 'top',
                        name: 'hostname'
                    }, {
                        xtype: 'textfield',
                        fieldLabel: 'ImageID',
                        labelAlign: 'top',
                        name: 'imageId'
                    }]
				},
				store: store
			}, ' ', {
				xtype: 'button',
				enableToggle: true,
				width: 200,
				text: 'Show terminated servers',
				toggleHandler: function (field, checked) {
					store.proxy.extraParams.hideTerminated = checked ? 'false' : 'true';
					store.loadPage(1);
				}
			}]
		}]
	});
});

import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableHighlight, View } from 'react-native';
import NaviBar from '@hecom/react-native-pure-navigation-bar';
import Navigation from '@hecom/navigation';
import ArrowImage from '@hecom/image-arrow';
import Constant from 'core/constant';
import TenantCenter from '@hecom/tenantcenter';
import UserInfo from '@hecom/userinfo';
import { FontScaleProvider } from 'core/util/fontScale';
import Toast from 'react-native-root-toast';
import MenuList from 'core/home/menu/menulist';
import Workbench from 'core/model/workbench';
import Listener from '@hecom/listener';
import Network from '@hecom/network';
import { getOfflineConfig } from 'core/object/model/OfflineManager';

function RenderSectionLine(props) {
    const { onPress, title } = props;
    return (
        <TouchableHighlight onPress={onPress} activeOpacity={0.9}>
            <View style={[styles.item, Constant.style.border_bottom_line]}>
                <Text style={styles.label} testID={title}>
                    {title}
                </Text>
                <ArrowImage style={styles.arrow} />
            </View>
        </TouchableHighlight>
    );
}

@FontScaleProvider({ invoke: true })
export default class PersonalSettingPage extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            isSuperAdmin: false,
            isShowReset: false,
        };
    }

    componentDidMount() {
        this.getIsSuperAdmin();
        this.loadConfigAuthority();
    }

    getIsSuperAdmin() {
        Network.post({}, '/paas/env/isSuperAdmin')
            .then(({ data }) => {
                this.setState({ isSuperAdmin: data });
            })
            .catch((error) => {
                Toast.show(error.message);
            });
    }

    _renderContent = () => (
        <ScrollView style={[styles.view, Constant.style.view_background]}>
            {TenantCenter.part.isDemo() ? null : (
                <TouchableHighlight
                    style={[styles.section]}
                    onPress={this._clickAccountSecurity}
                    activeOpacity={0.9}
                >
                    <View style={styles.item}>
                        <Text style={styles.label} testID={'账号与安全231232'}>
                            账号与安全
                        </Text>
                        <ArrowImage style={styles.arrow} />
                    </View>
                </TouchableHighlight>
            )}
            <View style={styles.section}>
                <RenderSectionLine onPress={this._clickFontScale} title={'字体大小'} />
                <RenderSectionLine onPress={this._clickMsgNotify} title={'消息通知'} />
                <RenderSectionLine onPress={this._clickPhotoSetting} title={'照片设置'} />
                {!!getOfflineConfig() && (
                    <RenderSectionLine onPress={this._clickOfflineDraft} title={'离线草稿'} />
                )}
                {/* <TouchableHighlight onPress={this._clickSystemStatus} activeOpacity={0.9}> */}
                {/*    <View style={styles.item}> */}
                {/*        <Text style={styles.label} testID={'系统状态'}> */}
                {/*            系统状态 */}
                {/*        </Text> */}
                {/*        <ArrowImage style={styles.arrow} /> */}
                {/*    </View> */}
                {/* </TouchableHighlight> */}
            </View>
            <TouchableHighlight
                style={[styles.section]}
                onPress={this._updateSysSetting}
                activeOpacity={0.9}
            >
                <View style={styles.item}>
                    <Text style={styles.label}>更新系统配置</Text>
                </View>
            </TouchableHighlight>
            {this.state.isSuperAdmin && this.state.isShowReset ? (
                <TouchableHighlight
                    style={[styles.section]}
                    onPress={this._tapCleaner}
                    activeOpacity={0.9}
                >
                    <View style={styles.item}>
                        <Text style={styles.label} numberOfLines={1}>
                            数据一键清除
                        </Text>
                    </View>
                </TouchableHighlight>
            ) : null}
            <TouchableHighlight
                style={[styles.section]}
                onPress={() => global.push(Constant.page.about_us)}
                activeOpacity={0.9}
            >
                <View style={styles.item}>
                    <Text style={styles.label} testID={'关于我们2312'}>
                        关于我们
                    </Text>
                    <ArrowImage style={styles.arrow} />
                </View>
            </TouchableHighlight>
            <TouchableHighlight
                style={[styles.section]}
                onPress={() => UserInfo.logout()}
                activeOpacity={0.9}
            >
                <View style={[styles.item, { justifyContent: 'center' }]}>
                    <Text style={styles.logoutLabel}>退出登录</Text>
                </View>
            </TouchableHighlight>
        </ScrollView>
    );

    _clickFontScale = () => {
        Navigation.push(Constant.page.fontScale_page);
    };

    _clickMsgNotify = () => {
        Navigation.push(Constant.page.msg_notify);
    };

    _clickOfflineDraft = () => {
        Navigation.push(Constant.page.offline_draft_setting);
    };

    _clickAccountSecurity = () => {
        Navigation.push(Constant.page.account_security);
    };

    _clickPhotoSetting = () => {
        Navigation.push(Constant.page.photo_setting);
    };

    _clickSystemStatus = () => {
        Navigation.push(Constant.page.system_status);
    };

    loadConfigAuthority() {
        Network.post(
            {
                packageName: 'EnterpriseSettings',
                featureName: 'entReset',
            },
            'paas/env/app/getFeatureValue'
        )
            .then(({ data }) => {
                this.setState({
                    isShowReset: data.boolValue,
                });
            })
            .catch((error) => {
                Toast.show(error.message);
            });
    }

    _updateSysSetting() {
        global.refresh(true);
        MenuList.load()
            .then(() => Workbench.load())
            .then(() => {
                Listener.trigger(Constant.listener.workbenchchange);
            })
            .then(() => Toast.show('已更新系统配置'))
            .catch(() => Toast.show('更新失败，请稍后再试'))
            .finally(() => global.refresh(false));
    }

    _tapCleaner() {
        Navigation.push(Constant.page.data_tap_clean_page);
    }

    render() {
        return (
            <View style={[styles.view, Constant.style.view_background]}>
                <NaviBar title="设置" />
                {this._renderContent()}
            </View>
        );
    }
}

const styles = StyleSheet.create({
    view: {
        flex: 1,
    },
    item: {
        alignItems: 'center',
        flexDirection: 'row',
    },
    label: {
        fontSize: 16,
        color: '#333',
        flex: 1,
        marginLeft: 12,
        paddingVertical: 14,
    },
    logoutLabel: {
        fontSize: 16,
        color: '#F93E40',
        marginLeft: 12,
        paddingVertical: 14,
    },
    arrow: {
        marginRight: 14,
        marginLeft: 10,
    },
    section: {
        marginTop: 10,
        backgroundColor: 'white',
    },
    versionName: {
        marginTop: 16,
        color: '#999',
        fontSize: 14,
        alignSelf: 'center',
    },
});

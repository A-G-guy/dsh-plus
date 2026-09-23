/**
 * 原生组件库门面：面板内所有 primitives 导入集中于此，上游升级漂移时
 * 单点替换/降级（遵循 dsh-plus「不绑定上游内部实现」原则）。
 * @module web-terminal/panel/primitives
 */
export {
  Button,
  IconCloseOutlineMedium,
  IconEditOutlineRegular,
  IconPlusOutlineMedium,
  IconTrashOutlineRegular,
  IconWarningOutlineRegular,
  Input,
  Menu,
  Modal,
  RiskConfirmation,
  Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'

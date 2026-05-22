/**
 * 自定义分类类型定义
 * 用于侧边栏的自定义分类功能
 */

/**
 * 自定义分类
 * 用户可以创建自定义分类来组织窗口、远程连接和组
 */
export interface CustomCategory {
  /** 分类唯一标识符 (UUID) */
  id: string;

  /** 分类名称 */
  name: string;

  /** 可选图标 (emoji 或图标名称) */
  icon?: string;

  /** 父分类 ID (支持嵌套分类) */
  parentId?: string;

  /** 包含的窗口 ID 列表 */
  windowIds: string[];

  /** 包含的组 ID 列表 */
  groupIds: string[];

  /** 包含的 SSH 配置 ID 列表 */
  sshProfileIds?: string[];

  /** 排序顺序 (数字越小越靠前) */
  order: number;

  /** 创建时间 (ISO 8601 格式) */
  createdAt: string;

  /** 最后更新时间 (ISO 8601 格式) */
  updatedAt: string;
}

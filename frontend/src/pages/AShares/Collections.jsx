import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PencilSimple, Plus, Trash, X } from "@phosphor-icons/react";
import AShares from "@/models/ashares";
import paths from "@/utils/paths";
import { IconButton, Message, PageHeading } from "./Common";

export default function Collections() {
  const [tab, setTab] = useState("tags");
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [groups, setGroups] = useState([]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(null);
  const [categoryName, setCategoryName] = useState("");
  const [editingCategory, setEditingCategory] = useState(null);
  const [tagName, setTagName] = useState("");
  const [tagCategory, setTagCategory] = useState("");
  const [tagColor, setTagColor] = useState("#4f8071");
  const [editingTag, setEditingTag] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [groupName, setGroupName] = useState("");
  const [groupKind, setGroupKind] = useState("fixed");
  const [groupBoard, setGroupBoard] = useState("");
  const [groupTag, setGroupTag] = useState("");
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [editingGroup, setEditingGroup] = useState(false);
  const [groupEditName, setGroupEditName] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [matches, setMatches] = useState([]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      AShares.categories(controller.signal),
      AShares.tags(controller.signal),
      AShares.groups(controller.signal),
    ])
      .then(([categoryResult, tagResult, groupResult]) => {
        setCategories(categoryResult.items);
        setTags(tagResult.items);
        setGroups(groupResult.items);
        setSelectedGroup(
          (previous) =>
            groupResult.items.find((item) => item.id === previous?.id) || null
        );
        setError(null);
      })
      .catch((failure) => {
        if (failure.name !== "AbortError") setError(failure.message);
      });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!memberQuery.trim()) {
      setMatches([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      AShares.search(memberQuery, controller.signal)
        .then((result) => setMatches(result.items))
        .catch((failure) => {
          if (failure.name !== "AbortError") setError(failure.message);
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [memberQuery]);

  async function createCategory(event) {
    event.preventDefault();
    try {
      if (editingCategory) {
        await AShares.updateCategory(editingCategory.id, {
          name: categoryName.trim(),
        });
      } else {
        await AShares.createCategory({ name: categoryName.trim() });
      }
      setCategoryName("");
      setEditingCategory(null);
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure.message);
    }
  }

  async function removeCategory(category) {
    if (confirmDelete !== `category-${category.id}`) {
      setConfirmDelete(`category-${category.id}`);
      return;
    }
    try {
      await AShares.deleteCategory(category.id);
      setConfirmDelete(null);
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure.message);
    }
  }

  async function saveTag(event) {
    event.preventDefault();
    const body = {
      category_id: Number(tagCategory),
      name: tagName.trim(),
      color: tagColor,
    };
    try {
      if (editingTag)
        await AShares.updateTag(editingTag.id, {
          ...body,
          version: editingTag.version,
        });
      else await AShares.createTag(body);
      setTagName("");
      setTagColor("#4f8071");
      setEditingTag(null);
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure.message);
    }
  }

  async function removeTag(tag) {
    if (confirmDelete !== `tag-${tag.id}`) {
      setConfirmDelete(`tag-${tag.id}`);
      return;
    }
    try {
      await AShares.deleteTag(tag.id);
      setConfirmDelete(null);
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure.message);
    }
  }

  async function createGroup(event) {
    event.preventDefault();
    const filter =
      groupKind === "dynamic"
        ? {
            board: groupBoard || undefined,
            include_tag_ids: groupTag ? [Number(groupTag)] : [],
          }
        : null;
    try {
      const group = await AShares.createGroup({
        name: groupName.trim(),
        kind: groupKind,
        symbols: [],
        filter,
      });
      setGroupName("");
      setSelectedGroup(group);
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure.message);
    }
  }

  async function updateMembers(nextSymbols) {
    try {
      const group = await AShares.setGroupMembers(selectedGroup.id, {
        symbols: nextSymbols,
        version: selectedGroup.version,
      });
      setSelectedGroup(group);
      setMemberQuery("");
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure.message);
    }
  }

  async function renameGroup(event) {
    event.preventDefault();
    try {
      const group = await AShares.renameGroup(selectedGroup.id, {
        name: groupEditName.trim(),
        version: selectedGroup.version,
      });
      setSelectedGroup(group);
      setEditingGroup(false);
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure.message);
    }
  }

  async function removeGroup(group) {
    if (confirmDelete !== `group-${group.id}`) {
      setConfirmDelete(`group-${group.id}`);
      return;
    }
    try {
      await AShares.deleteGroup(group.id);
      setSelectedGroup(null);
      setConfirmDelete(null);
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure.message);
    }
  }

  return (
    <>
      <PageHeading title="标签与分组" detail="共享分类、自选与分组" />
      {error && (
        <Message tone="error" onRetry={() => setRevision((value) => value + 1)}>
          {error}
        </Message>
      )}
      <div className="ashares-tabbar" role="tablist" aria-label="集合视图">
        <button
          role="tab"
          aria-selected={tab === "tags"}
          className={tab === "tags" ? "active" : ""}
          onClick={() => setTab("tags")}
        >
          标签
        </button>
        <button
          role="tab"
          aria-selected={tab === "groups"}
          className={tab === "groups" ? "active" : ""}
          onClick={() => setTab("groups")}
        >
          分组
        </button>
      </div>
      {tab === "tags" ? (
        <div className="ashares-collections-layout">
          <section>
            <h2>标签分类</h2>
            <form className="ashares-inline-form" onSubmit={createCategory}>
              <input
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
                placeholder="分类名称"
                maxLength={80}
                required
              />
              <button type="submit" className="ashares-primary-button">
                {editingCategory ? (
                  "保存"
                ) : (
                  <>
                    <Plus size={17} /> 添加
                  </>
                )}
              </button>
              {editingCategory && (
                <IconButton
                  label="取消编辑分类"
                  onClick={() => {
                    setEditingCategory(null);
                    setCategoryName("");
                  }}
                >
                  <X size={17} />
                </IconButton>
              )}
            </form>
            <div className="ashares-collection-list">
              {categories.map((category) => (
                <div key={category.id} className="ashares-collection-row">
                  <span>{category.name}</span>
                  <small>
                    {
                      tags.filter((tag) => tag.category_id === category.id)
                        .length
                    }{" "}
                    个标签
                  </small>
                  <IconButton
                    label={`编辑 ${category.name}`}
                    onClick={() => {
                      setEditingCategory(category);
                      setCategoryName(category.name);
                    }}
                  >
                    <PencilSimple size={17} />
                  </IconButton>
                  <IconButton
                    label={
                      confirmDelete === `category-${category.id}`
                        ? "确认删除分类"
                        : "删除分类"
                    }
                    onClick={() => removeCategory(category)}
                    className={
                      confirmDelete === `category-${category.id}`
                        ? "danger"
                        : ""
                    }
                  >
                    <Trash size={17} />
                  </IconButton>
                </div>
              ))}
              {!categories.length && <Message>暂无分类</Message>}
            </div>
          </section>
          <section>
            <h2>标签</h2>
            <form className="ashares-tag-form" onSubmit={saveTag}>
              <select
                value={tagCategory}
                onChange={(event) => setTagCategory(event.target.value)}
                required
                aria-label="标签分类"
              >
                <option value="">选择分类</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <input
                value={tagName}
                onChange={(event) => setTagName(event.target.value)}
                placeholder="标签名称"
                maxLength={80}
                required
              />
              <label className="ashares-color-control" title="标签颜色">
                <input
                  type="color"
                  value={tagColor}
                  onChange={(event) => setTagColor(event.target.value)}
                  aria-label="标签颜色"
                />
              </label>
              <button type="submit" className="ashares-primary-button">
                {editingTag ? "保存" : "添加"}
              </button>
              {editingTag && (
                <IconButton
                  label="取消编辑"
                  onClick={() => {
                    setEditingTag(null);
                    setTagName("");
                  }}
                >
                  <X size={17} />
                </IconButton>
              )}
            </form>
            <div className="ashares-collection-list">
              {tags.map((tag) => (
                <div key={tag.id} className="ashares-collection-row">
                  <i
                    className="ashares-color-dot"
                    style={{ background: tag.color }}
                  />
                  <strong>{tag.name}</strong>
                  <small>
                    {
                      categories.find(
                        (category) => category.id === tag.category_id
                      )?.name
                    }
                  </small>
                  <IconButton
                    label={`编辑 ${tag.name}`}
                    onClick={() => {
                      setEditingTag(tag);
                      setTagName(tag.name);
                      setTagCategory(String(tag.category_id));
                      setTagColor(tag.color);
                    }}
                  >
                    <PencilSimple size={17} />
                  </IconButton>
                  <IconButton
                    label={
                      confirmDelete === `tag-${tag.id}`
                        ? `确认删除 ${tag.name}`
                        : `删除 ${tag.name}`
                    }
                    onClick={() => removeTag(tag)}
                    className={
                      confirmDelete === `tag-${tag.id}` ? "danger" : ""
                    }
                  >
                    <Trash size={17} />
                  </IconButton>
                </div>
              ))}
              {!tags.length && <Message>暂无标签</Message>}
            </div>
          </section>
        </div>
      ) : (
        <div className="ashares-collections-layout">
          <section>
            <h2>分组</h2>
            <form className="ashares-group-form" onSubmit={createGroup}>
              <input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="分组名称"
                maxLength={100}
                required
              />
              <div className="ashares-segmented" aria-label="分组类型">
                <button
                  type="button"
                  aria-pressed={groupKind === "fixed"}
                  onClick={() => setGroupKind("fixed")}
                >
                  固定
                </button>
                <button
                  type="button"
                  aria-pressed={groupKind === "dynamic"}
                  onClick={() => setGroupKind("dynamic")}
                >
                  动态
                </button>
              </div>
              {groupKind === "dynamic" && (
                <>
                  <select
                    value={groupBoard}
                    onChange={(event) => setGroupBoard(event.target.value)}
                    aria-label="动态分组板块"
                  >
                    <option value="">全部板块</option>
                    <option value="SSE_MAIN">沪市主板</option>
                    <option value="SZSE_MAIN">深市主板</option>
                    <option value="CHINEXT">创业板</option>
                    <option value="STAR">科创板</option>
                  </select>
                  <select
                    value={groupTag}
                    onChange={(event) => setGroupTag(event.target.value)}
                    aria-label="动态分组标签"
                  >
                    <option value="">全部标签</option>
                    {tags.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <button
                type="submit"
                className="ashares-primary-button"
                disabled={groupKind === "dynamic" && !groupBoard && !groupTag}
              >
                <Plus size={17} /> 创建分组
              </button>
            </form>
            <div className="ashares-collection-list">
              {groups.map((group) => (
                <button
                  key={group.id}
                  className={`ashares-group-row${selectedGroup?.id === group.id ? " active" : ""}`}
                  onClick={() => {
                    setSelectedGroup(group);
                    setEditingGroup(false);
                    setConfirmDelete(null);
                  }}
                >
                  <strong>{group.name}</strong>
                  <span>
                    {group.kind === "dynamic"
                      ? "动态"
                      : `${group.symbols.length} 只`}
                  </span>
                </button>
              ))}
              {!groups.length && <Message>暂无分组</Message>}
            </div>
          </section>
          <section>
            {selectedGroup ? (
              <>
                <div className="ashares-pane-header">
                  {editingGroup ? (
                    <form
                      className="ashares-inline-form"
                      onSubmit={renameGroup}
                    >
                      <input
                        value={groupEditName}
                        onChange={(event) =>
                          setGroupEditName(event.target.value)
                        }
                        maxLength={100}
                        required
                        aria-label="分组名称"
                      />
                      <button type="submit">保存</button>
                      <IconButton
                        label="取消改名"
                        onClick={() => setEditingGroup(false)}
                      >
                        <X size={17} />
                      </IconButton>
                    </form>
                  ) : (
                    <strong>{selectedGroup.name}</strong>
                  )}
                  <div className="ashares-heading-actions">
                    <IconButton
                      label="重命名分组"
                      onClick={() => {
                        setGroupEditName(selectedGroup.name);
                        setEditingGroup(true);
                      }}
                    >
                      <PencilSimple size={17} />
                    </IconButton>
                    <IconButton
                      label={
                        confirmDelete === `group-${selectedGroup.id}`
                          ? "确认删除分组"
                          : "删除分组"
                      }
                      onClick={() => removeGroup(selectedGroup)}
                      className={
                        confirmDelete === `group-${selectedGroup.id}`
                          ? "danger"
                          : ""
                      }
                    >
                      <Trash size={17} />
                    </IconButton>
                  </div>
                </div>
                {selectedGroup.kind === "fixed" ? (
                  <>
                    <div className="ashares-search-combo">
                      <input
                        value={memberQuery}
                        onChange={(event) => setMemberQuery(event.target.value)}
                        placeholder="搜索股票并添加"
                        aria-label="添加分组股票"
                      />
                      {matches.length > 0 && (
                        <div className="ashares-suggestions">
                          {matches
                            .filter(
                              (item) =>
                                !selectedGroup.symbols.includes(item.symbol)
                            )
                            .slice(0, 8)
                            .map((item) => (
                              <button
                                key={item.symbol}
                                onClick={() =>
                                  updateMembers([
                                    ...selectedGroup.symbols,
                                    item.symbol,
                                  ])
                                }
                              >
                                <Plus size={16} /> {item.name}{" "}
                                <span>{item.symbol}</span>
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                    <div className="ashares-collection-list">
                      {selectedGroup.symbols.map((symbol) => (
                        <div key={symbol} className="ashares-collection-row">
                          <Link to={paths.ashares.stock(symbol)}>{symbol}</Link>
                          <IconButton
                            label={`移除 ${symbol}`}
                            onClick={() =>
                              updateMembers(
                                selectedGroup.symbols.filter(
                                  (item) => item !== symbol
                                )
                              )
                            }
                          >
                            <X size={17} />
                          </IconButton>
                        </div>
                      ))}
                      {!selectedGroup.symbols.length && (
                        <Message>暂无成员</Message>
                      )}
                    </div>
                  </>
                ) : (
                  <dl className="ashares-profile">
                    <div>
                      <dt>板块</dt>
                      <dd>{selectedGroup.filter?.board || "全部"}</dd>
                    </div>
                    <div>
                      <dt>标签</dt>
                      <dd>
                        {tags.find(
                          (tag) =>
                            tag.id ===
                            selectedGroup.filter?.include_tag_ids?.[0]
                        )?.name || "全部"}
                      </dd>
                    </div>
                  </dl>
                )}
              </>
            ) : (
              <Message>选择分组查看成员</Message>
            )}
          </section>
        </div>
      )}
    </>
  );
}
